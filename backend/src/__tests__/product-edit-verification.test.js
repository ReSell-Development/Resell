/**
 * Listing edit re-verification — integration tests.
 *
 * Verifies that PUT /api/products/:id runs the same image-fraud defenses
 * as listing creation when the image set changes:
 *   - server-side perceptual + mirror hashing (client hashes untrusted)
 *   - duplicate detection against other active/sold listings (hamming <= 12)
 *   - mirrored duplicates rejected
 *   - full AI analysis re-queued through the existing worker pipeline
 *   - fraud/risk score recalculated
 * and that edits without image changes keep their existing behavior.
 * Rejected updates must leave the product fully unchanged and clean up
 * the rejected Cloudinary assets.
 */

const request = require('supertest');
const mongoose = require('mongoose');
const sharp = require('sharp');
const { app, server } = require('../server');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const {
  perceptualHashFromBuffer,
  mirrorPerceptualHashFromBuffer,
  hammingDistance,
} = require('../services/imageHash');
const { imageProcessingQueue } = require('../queues');

// Spy on Cloudinary cleanup while keeping the real (no-op unconfigured) behavior
jest.mock('../config/cloudinary', () => {
  const actual = jest.requireActual('../config/cloudinary');
  return {
    ...actual,
    deleteFromCloudinary: jest.fn(actual.deleteFromCloudinary),
  };
});

const { deleteFromCloudinary } = require('../config/cloudinary');

const extractToken = (res) => {
  const setCookie = res.headers['set-cookie'] || [];
  const c = setCookie.find((s) => s.startsWith('access_token='));
  return c ? c.split(';')[0].split('=')[1] : null;
};

const toDataUrl = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;

describe('Listing edit re-verification (PUT /api/products/:id)', () => {
  let sellerA, sellerB, sellerAToken, sellerBToken, category, category2, productA, productB;

  const queueAddSpy = jest.spyOn(imageProcessingQueue, 'add');

  /** Solid-color test image */
  const makeImage = (r, g, b, size = 100) =>
    sharp({ create: { width: size, height: size, channels: 3, background: { r, g, b } } })
      .png()
      .toBuffer();

  /** Strongly asymmetric image (left half white, right half black) —
   *  mirroring it produces a very different pHash. */
  const makeAsymImage = async () => {
    const white = await makeImage(255, 255, 255, 100);
    return sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([{ input: white, left: 0, top: 0 }])
      .png()
      .toBuffer();
  };

  beforeAll(async () => {
    // server module is loaded at require time; nothing needed here
  });

  afterAll(async () => {
    await server.close();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  beforeEach(async () => {
    queueAddSpy.mockClear();
    deleteFromCloudinary.mockClear();

    sellerA = await User.create({
      name: 'Victim Seller',
      email: `victim-${Date.now()}@example.com`,
      password: 'password123',
      role: 'seller',
    });
    sellerB = await User.create({
      name: 'Editor Seller',
      email: `editor-${Date.now()}@example.com`,
      password: 'password123',
      role: 'seller',
    });

    const loginA = await request(app)
      .post('/api/auth/login')
      .send({ email: sellerA.email, password: 'password123' });
    sellerAToken = extractToken(loginA);

    const loginB = await request(app)
      .post('/api/auth/login')
      .send({ email: sellerB.email, password: 'password123' });
    sellerBToken = extractToken(loginB);

    category = await Category.create({
      name: 'Edit Cat',
      slug: `edit-cat-${Date.now()}`,
      icon: 'box',
    });
    category2 = await Category.create({
      name: 'Other Cat',
      slug: `other-cat-${Date.now()}`,
      icon: 'box',
    });

    // Victim listing with the asymmetric image
    const asymBuffer = await makeAsymImage();
    const asymHash = await perceptualHashFromBuffer(asymBuffer);
    productA = await Product.create({
      title: 'Original Asym Item',
      description: 'Victim listing',
      price: 100,
      category: category._id,
      images: [{ url: 'http://x.com/asym.jpg', publicId: 'asym-img' }],
      seller: sellerA._id,
      status: 'active',
      aiAnalysis: { imageHashes: [asymHash] },
    });

    // The listing we edit — starts with a plain image far from the victim's
    const ownBuffer = await makeImage(30, 140, 255);
    const ownHash = await perceptualHashFromBuffer(ownBuffer);
    productB = await Product.create({
      title: 'Editable Item',
      description: 'Belongs to seller B',
      price: 50,
      category: category._id,
      images: [{ url: 'http://x.com/own.jpg', publicId: 'own-img' }],
      seller: sellerB._id,
      status: 'active',
      aiAnalysis: {
        imageHashes: [ownHash],
        riskAssessment: { riskScore: 0, riskLevel: 'low', factors: [], assessedAt: new Date(0) },
      },
    });
  });

  const updateProduct = (token, body) =>
    request(app).put(`/api/products/${productB._id}`).set('Cookie', `access_token=${token}`).send(body);

  it('updates non-image fields without running the verification pipeline', async () => {
    const res = await updateProduct(sellerBToken, { title: 'Renamed', price: 75 }).expect(200);

    expect(res.body.product.title).toBe('Renamed');
    expect(res.body.product.price).toBe(75);
    expect(res.body.product.images[0].publicId).toBe('own-img');
    expect(queueAddSpy).not.toHaveBeenCalled();
  });

  it('re-sending the same images is an unchanged edit (no re-verification)', async () => {
    const res = await updateProduct(sellerBToken, {
      title: 'Same Images Edit',
      images: [{ url: 'http://x.com/own.jpg', publicId: 'own-img' }],
    }).expect(200);

    expect(res.body.product.title).toBe('Same Images Edit');
    expect(res.body.product.images[0].publicId).toBe('own-img');
    expect(queueAddSpy).not.toHaveBeenCalled();
  });

  it('verifies a genuine image replacement and re-queues AI analysis + risk', async () => {
    const fresh = await makeImage(120, 30, 90);
    const freshHash = await perceptualHashFromBuffer(fresh);
    const freshMirror = await mirrorPerceptualHashFromBuffer(fresh);
    const assessedBefore = productB.aiAnalysis.riskAssessment.assessedAt;

    const res = await updateProduct(sellerBToken, {
      images: [{ url: toDataUrl(fresh), publicId: 'fresh-1' }],
    }).expect(200);

    expect(res.body.product.images[0].publicId).toBe('fresh-1');

    const updated = await Product.findById(productB._id);
    expect(updated.aiAnalysis.imageHashes).toContain(freshHash);
    expect(updated.aiAnalysis.imageHashes).toContain(freshMirror);
    expect(updated.images[0].perceptualHash).toBe(freshHash);

    // AI analysis re-queued through the existing worker pipeline
    expect(queueAddSpy).toHaveBeenCalledWith(
      'analyze-product',
      expect.objectContaining({ productId: productB._id.toString() })
    );

    // Fraud score recalculated
    expect(updated.aiAnalysis.riskAssessment.assessedAt.getTime()).toBeGreaterThan(
      assessedBefore.getTime()
    );
  });

  it('rejects replacing images with a duplicate of another listing (no partial update)', async () => {
    const asymBuffer = await makeAsymImage();
    const res = await updateProduct(sellerBToken, {
      title: 'Should Not Apply',
      images: [{ url: toDataUrl(asymBuffer), publicId: 'stolen-1' }],
    }).expect(409);

    expect(res.body.code).toBe('DUPLICATE_IMAGE');

    // Product fully unchanged — no partial update
    const after = await Product.findById(productB._id);
    expect(after.title).toBe('Editable Item');
    expect(after.images.map((i) => i.publicId)).toEqual(['own-img']);
    expect(after.aiAnalysis.imageHashes).not.toContain(await perceptualHashFromBuffer(asymBuffer));
  });

  it('rejects a mirrored duplicate of another listing', async () => {
    const asymBuffer = await makeAsymImage();
    const flopped = await sharp(asymBuffer).flop().png().toBuffer();

    // Sanity: the flipped copy evades the plain hash by a wide margin
    const plainDistance = hammingDistance(
      await perceptualHashFromBuffer(asymBuffer),
      await perceptualHashFromBuffer(flopped)
    );
    expect(plainDistance).toBeGreaterThan(12);

    const res = await updateProduct(sellerBToken, {
      title: 'Mirror Trick',
      images: [{ url: toDataUrl(flopped), publicId: 'mirror-1' }],
    }).expect(409);

    expect(res.body.code).toBe('DUPLICATE_IMAGE');
  });

  it('allows a similar-but-distinct image outside the threshold (boundary behavior)', async () => {
    // Blue vs orange solid images: hamming distance 14 > threshold 12
    const orange = await makeImage(255, 80, 20);
    const res = await updateProduct(sellerBToken, {
      images: [{ url: toDataUrl(orange), publicId: 'orange-1' }],
    }).expect(200);

    expect(res.body.product.images[0].publicId).toBe('orange-1');
  });

  it('keeps duplicate detection scoped to the listing category', async () => {
    // Victim listing with the same image, but in a different category
    const fresh = await makeImage(120, 30, 90);
    const freshHash = await perceptualHashFromBuffer(fresh);
    await Product.create({
      title: 'Same image, other category',
      description: 'Different category listing',
      price: 100,
      category: category2._id,
      images: [{ url: 'http://x.com/other.jpg', publicId: 'other-img' }],
      seller: sellerA._id,
      status: 'active',
      aiAnalysis: { imageHashes: [freshHash] },
    });

    // Editing a cat-1 listing with that image is allowed — the cat-2
    // listing is not a candidate, exactly like the upload-time check.
    await updateProduct(sellerBToken, {
      images: [{ url: toDataUrl(fresh), publicId: 'fresh-2' }],
    }).expect(200);
  });

  it('rejects unfetchable new image URLs and leaves the product unchanged', async () => {
    const res = await updateProduct(sellerBToken, {
      title: 'Also Should Not Apply',
      images: [{ url: 'http://127.0.0.1:9/unreachable.jpg', publicId: 'bad-1' }],
    }).expect(400);

    expect(res.body.code).toBe('IMAGE_VERIFICATION_FAILED');

    const after = await Product.findById(productB._id);
    expect(after.title).toBe('Editable Item');
    expect(after.images.map((i) => i.publicId)).toEqual(['own-img']);
  });

  it('cleans up rejected Cloudinary assets but preserves referenced ones', async () => {
    const asymBuffer = await makeAsymImage();

    // 'shared-img' belongs to another listing and must NOT be deleted
    await Product.create({
      title: 'Shared asset owner',
      description: 'References shared-img',
      price: 10,
      category: category._id,
      images: [{ url: 'http://x.com/shared.jpg', publicId: 'shared-img' }],
      seller: sellerA._id,
      status: 'active',
      aiAnalysis: { imageHashes: [] },
    });

    await updateProduct(sellerBToken, {
      images: [
        { url: toDataUrl(asymBuffer), publicId: 'rejected-new-1' },
        { url: toDataUrl(asymBuffer), publicId: 'shared-img' },
      ],
    }).expect(409);

    // The brand-new asset is cleaned up; shared + existing assets are not
    expect(deleteFromCloudinary).toHaveBeenCalledWith('rejected-new-1');
    expect(deleteFromCloudinary).not.toHaveBeenCalledWith('shared-img');
    expect(deleteFromCloudinary).not.toHaveBeenCalledWith('own-img');
  });

  it('still rejects editing another seller’s listing', async () => {
    await request(app)
      .put(`/api/products/${productA._id}`)
      .set('Cookie', `access_token=${sellerBToken}`)
      .send({ title: 'Not Yours' })
      .expect(403);
  });
});
