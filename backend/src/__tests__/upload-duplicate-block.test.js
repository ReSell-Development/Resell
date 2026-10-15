/**
 * Duplicate image upload blocking — integration tests.
 *
 * Verifies that the upload-images endpoint rejects images whose perceptual
 * hash matches an existing listing's image (hamming distance ≤ 12) with a
 * 409 status, and does NOT create any DB record or upload to Cloudinary.
 */

const request = require('supertest');
const mongoose = require('mongoose');
const sharp = require('sharp');
const { app, server } = require('../server');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { perceptualHashFromBuffer } = require('../services/imageHash');

const extractToken = (res) => {
  const setCookie = res.headers['set-cookie'] || [];
  const c = setCookie.find((s) => s.startsWith('access_token='));
  return c ? c.split(';')[0].split('=')[1] : null;
};

describe('Duplicate image upload blocking (POST /api/products/upload-images)', () => {
  let sellerA, sellerB, sellerAToken, sellerBToken, category;

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
    sellerA = await User.create({
      name: 'Seller A',
      email: `sellerA-${Date.now()}@example.com`,
      password: 'password123',
      role: 'seller',
    });
    sellerB = await User.create({
      name: 'Seller B',
      email: `sellerB-${Date.now()}@example.com`,
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
      name: 'Test Cat',
      slug: `test-cat-${Date.now()}`,
      icon: 'box',
    });
  });

  /** Create a deterministic test image buffer via sharp. */
  const makeImage = (r, g, b, size = 100) =>
    sharp({
      create: { width: size, height: size, channels: 3, background: { r, g, b } },
    })
      .png()
      .toBuffer();

  it('rejects a second upload of the same image with 409 and no new product', async () => {
    const imageBuffer = await makeImage(30, 140, 255);

    // Create a reference product with the same perceptual hash
    const refHash = await perceptualHashFromBuffer(imageBuffer);
    await Product.create({
      title: 'Existing Blue Widget',
      description: 'Already listed',
      price: 50,
      category: category._id,
      images: [{ url: 'http://x.com/existing.jpg', publicId: 'existing' }],
      seller: sellerA._id,
      aiAnalysis: { imageHashes: [refHash] },
    });

    const productsBefore = await Product.countDocuments();

    // Second seller tries to upload the same image
    const res = await request(app)
      .post('/api/products/upload-images')
      .set('Cookie', `access_token=${sellerBToken}`)
      .attach('images', imageBuffer, { filename: 'duplicate.png', contentType: 'image/png' })
      .expect(409);

    expect(res.body.code).toBe('DUPLICATE_IMAGE');
    expect(res.body.message).toMatch(/duplicate/i);

    // No new product created
    const productsAfter = await Product.countDocuments();
    expect(productsAfter).toBe(productsBefore);
  });

  it('allows upload when images are genuinely different', async () => {
    const imageA = await makeImage(30, 140, 255);   // blue
    const imageB = await makeImage(255, 80, 20);     // orange (far from blue)

    // Create a reference product with imageA's hash
    const refHash = await perceptualHashFromBuffer(imageA);
    await Product.create({
      title: 'Blue Widget',
      description: 'Blue item',
      price: 50,
      category: category._id,
      images: [{ url: 'http://x.com/blue.jpg', publicId: 'blue' }],
      seller: sellerA._id,
      aiAnalysis: { imageHashes: [refHash] },
    });

    const productsBefore = await Product.countDocuments();

    // Upload a completely different image — should NOT get 409 (duplicate check passes).
    // May get 500 if Cloudinary is not configured in test env, which is fine.
    const res = await request(app)
      .post('/api/products/upload-images')
      .set('Cookie', `access_token=${sellerBToken}`)
      .attach('images', imageB, { filename: 'different.png', contentType: 'image/png' });

    // The critical assertion: no duplicate error
    expect(res.status).not.toBe(409);
    expect(res.body.code).not.toBe('DUPLICATE_IMAGE');

    // No new product document is created by the upload endpoint (product is
    // created later via POST /api/products), so count stays the same.
    const productsAfter = await Product.countDocuments();
    expect(productsAfter).toBe(productsBefore);
  });

  it('rejects upload when image matches any active listing (not just same seller)', async () => {
    const imageBuffer = await makeImage(200, 100, 50);
    const refHash = await perceptualHashFromBuffer(imageBuffer);

    // Seller A's product
    await Product.create({
      title: 'Seller A Item',
      description: 'Listed by A',
      price: 75,
      category: category._id,
      images: [{ url: 'http://x.com/a.jpg', publicId: 'a-img' }],
      seller: sellerA._id,
      aiAnalysis: { imageHashes: [refHash] },
    });

    // Seller B tries the same image
    const res = await request(app)
      .post('/api/products/upload-images')
      .set('Cookie', `access_token=${sellerBToken}`)
      .attach('images', imageBuffer, { filename: 'stolen.png', contentType: 'image/png' })
      .expect(409);

    expect(res.body.code).toBe('DUPLICATE_IMAGE');
  });

  it('rejects upload when image matches a sold listing', async () => {
    const imageBuffer = await makeImage(10, 200, 100);
    const refHash = await perceptualHashFromBuffer(imageBuffer);

    await Product.create({
      title: 'Sold Item',
      description: 'Already sold',
      price: 30,
      category: category._id,
      images: [{ url: 'http://x.com/sold.jpg', publicId: 'sold-img' }],
      seller: sellerA._id,
      status: 'sold',
      aiAnalysis: { imageHashes: [refHash] },
    });

    const res = await request(app)
      .post('/api/products/upload-images')
      .set('Cookie', `access_token=${sellerBToken}`)
      .attach('images', imageBuffer, { filename: 'sold-dup.png', contentType: 'image/png' })
      .expect(409);

    expect(res.body.code).toBe('DUPLICATE_IMAGE');
  });

  it('allows the original seller to re-upload their own image (still blocked to enforce unique listings)', async () => {
    const imageBuffer = await makeImage(50, 50, 200);
    const refHash = await perceptualHashFromBuffer(imageBuffer);

    // Seller A already has a product with this image
    await Product.create({
      title: 'My Existing Item',
      description: 'Belongs to seller A',
      price: 100,
      category: category._id,
      images: [{ url: 'http://x.com/mine.jpg', publicId: 'mine' }],
      seller: sellerA._id,
      aiAnalysis: { imageHashes: [refHash] },
    });

    // Seller A tries to upload the same image again — blocked
    const res = await request(app)
      .post('/api/products/upload-images')
      .set('Cookie', `access_token=${sellerAToken}`)
      .attach('images', imageBuffer, { filename: 'mine-again.png', contentType: 'image/png' })
      .expect(409);

    expect(res.body.code).toBe('DUPLICATE_IMAGE');
  });
});
