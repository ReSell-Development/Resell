/**
 * Image fraud detection improvements (SCRUM-6) — unit + integration tests.
 *
 * Covers:
 *  1. pHash consistency: variants.hash === perceptualHashFromBuffer output
 *  2. Mirror-evasion gap: flipped images get a very different primary pHash
 *     (why mirrors evaded the old single-hash detection)
 *  3. Mirror-invariance: hash(flop(X)) === mirroredHash(X) — the property
 *     that lets stored mirror variants catch flipped re-uploads
 *  4. Brightness robustness: linear brightness changes barely move the pHash
 *  5. Upload endpoint blocks a mirror-flipped copy of an existing image (409)
 *  6. detectRisk flags listings whose hash matches a stored mirror variant
 *  7. detectRisk reports the BEST (most similar) duplicate match, not the
 *     first candidate scanned
 *  8. MobileNet label → category mapping uses word boundaries:
 *     "cardigan" is Fashion (not Automotive via "car"),
 *     "bookcase" is Home & Garden (not Books & Media via "book")
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
  perceptualHashVariantsFromBuffer,
  hammingDistance,
} = require('../services/imageHash');
const { mapPredictionsToCategory } = require('../services/imageClassifier');
const { detectRisk } = require('../services/fraudDetection');

/** Deterministic, horizontally ASYMMETRIC test image (raw pixel gradient). */
const makeAsymmetricImage = (width = 120, height = 90) => {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 7 + y * 3) % 256;
      raw[i + 1] = (x * 13 + y * 5) % 256;
      raw[i + 2] = (x * 2 + y * 11) % 256;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
};

describe('Image fraud detection improvements', () => {
  let seller, category, imageBuffer, variants, floppedBuffer, floppedVariants;

  afterAll(async () => {
    await server.close();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  beforeAll(async () => {
    imageBuffer = await makeAsymmetricImage();
    floppedBuffer = await sharp(imageBuffer).flop().png().toBuffer();
    variants = await perceptualHashVariantsFromBuffer(imageBuffer);
    floppedVariants = await perceptualHashVariantsFromBuffer(floppedBuffer);
  });

  beforeEach(async () => {
    seller = await User.create({
      name: 'Image Fraud Seller',
      email: `imgfraud-${Date.now()}@example.com`,
      password: 'password123',
      role: 'seller',
      createdAt: new Date(Date.now() - 365 * 86400000),
    });
    category = await Category.create({
      name: 'Image Fraud Cat',
      slug: `imgfraud-cat-${Date.now()}`,
      icon: 'box',
    });
  });

  // ─── pHash variant computation ───

  describe('perceptualHashVariantsFromBuffer', () => {
    it('primary variant matches perceptualHashFromBuffer (backward compat)', async () => {
      expect(variants.hash).toBe(await perceptualHashFromBuffer(imageBuffer));
      expect(variants.hash).toMatch(/^[a-f0-9]{16}$/);
      expect(variants.mirroredHash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('a mirrored image gets a very different primary pHash (the evasion gap)', () => {
      // This is why flipped copies previously evaded pHash matching
      const distance = hammingDistance(variants.hash, variants.mirroredHash);
      expect(distance).toBeGreaterThan(12);
    });

    it('mirror-invariance: hash(flop(X)) === mirroredHash(X) — closes the gap', () => {
      expect(floppedVariants.hash).toBe(variants.mirroredHash);
      expect(floppedVariants.mirroredHash).toBe(variants.hash);
    });

    it('is robust to linear brightness changes (well below the 12 threshold)', async () => {
      const bright = await sharp(imageBuffer).modulate({ brightness: 1.4 }).png().toBuffer();
      const dark = await sharp(imageBuffer).modulate({ brightness: 0.6 }).png().toBuffer();
      const brightHash = await perceptualHashFromBuffer(bright);
      const darkHash = await perceptualHashFromBuffer(dark);
      // Resampling + 8-bit re-quantization perturbs a few near-median bits,
      // but the distance stays far below the duplicate threshold of 12
      // (different products sit at distance ≥ 30).
      expect(hammingDistance(brightHash, variants.hash)).toBeLessThanOrEqual(6);
      expect(hammingDistance(darkHash, variants.hash)).toBeLessThanOrEqual(6);
    });
  });

  // ─── Mirror-aware duplicate detection ───

  describe('detectRisk catches mirrored variants', () => {
    it('flags a listing whose hash matches a stored mirror variant', async () => {
      // Existing listing stores BOTH the normal and mirrored hashes
      await Product.create({
        title: 'Original Listing',
        description: 'Stores both variants',
        price: 100,
        category: category._id,
        images: [{ url: 'http://x.com/orig.jpg', publicId: 'orig' }],
        seller: seller._id,
        aiAnalysis: { imageHashes: [variants.hash, variants.mirroredHash] },
      });

      // Fraudster uploads the MIRRORED image; only its primary hash is checked
      const product = await Product.create({
        title: 'Mirrored Copy',
        description: 'Flipped version of the original',
        price: 80,
        category: category._id,
        images: [{ url: 'http://x.com/mirror.jpg', publicId: 'mirror' }],
        seller: seller._id,
        aiAnalysis: { imageHashes: [floppedVariants.hash] },
      });

      const result = await detectRisk({
        product,
        hashes: [floppedVariants.hash],
        aiAnalysis: { damageScore: 10 },
      });

      expect(result.riskScore).toBeGreaterThanOrEqual(35);
      expect(result.factors.some((f) => f.includes('Duplicate image'))).toBe(true);
    });

    it('reports the BEST (most similar) duplicate match, not the first scanned', async () => {
      const H = variants.hash;
      // Noisy match: distance 4 (created first — old code reported this one)
      const noisyHash = (BigInt('0x' + H) ^ 0xfn).toString(16).padStart(16, '0');
      expect(hammingDistance(H, noisyHash)).toBe(4);
      await Product.create({
        title: 'Noisy Match Listing',
        description: 'Distance 4 — similar but not identical',
        price: 50,
        category: category._id,
        images: [{ url: 'http://x.com/noisy.jpg', publicId: 'noisy' }],
        seller: seller._id,
        aiAnalysis: { imageHashes: [noisyHash] },
      });
      // Exact match: distance 0 (created second)
      await Product.create({
        title: 'Best Match Listing',
        description: 'Distance 0 — identical hash',
        price: 60,
        category: category._id,
        images: [{ url: 'http://x.com/best.jpg', publicId: 'best' }],
        seller: seller._id,
        aiAnalysis: { imageHashes: [H] },
      });

      const product = await Product.create({
        title: 'New Listing',
        description: 'Whose image matches both candidates',
        price: 70,
        category: category._id,
        images: [{ url: 'http://x.com/new.jpg', publicId: 'new' }],
        seller: seller._id,
        aiAnalysis: { imageHashes: [H] },
      });

      const result = await detectRisk({
        product,
        hashes: [H],
        aiAnalysis: { damageScore: 10 },
      });

      expect(result.riskScore).toBeGreaterThanOrEqual(35);
      const dupFactor = result.factors.find((f) => f.includes('Duplicate image'));
      expect(dupFactor).toBeTruthy();
      expect(dupFactor).toContain('Best Match Listing');
      expect(dupFactor).not.toContain('Noisy Match Listing');
      expect(dupFactor).toContain('distance: 0');
    });
  });

  // ─── Upload endpoint blocks flipped copies ───

  describe('POST /api/products/upload-images blocks mirror-flipped copies', () => {
    const extractToken = (res) => {
      const setCookie = res.headers['set-cookie'] || [];
      const c = setCookie.find((s) => s.startsWith('access_token='));
      return c ? c.split(';')[0].split('=')[1] : null;
    };

    it('rejects a horizontally flipped copy of an existing image with 409', async () => {
      // Existing listing stores both hash variants (as the create flow now does)
      await Product.create({
        title: 'Genuine Photo Owner',
        description: 'Original listing with both variants',
        price: 100,
        category: category._id,
        images: [{ url: 'http://x.com/orig.jpg', publicId: 'orig' }],
        seller: seller._id,
        aiAnalysis: { imageHashes: [variants.hash, variants.mirroredHash] },
      });

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: seller.email, password: 'password123' });
      const token = extractToken(login);

      // A different seller uploads the flipped copy
      const thief = await User.create({
        name: 'Image Thief',
        email: `thief-${Date.now()}@example.com`,
        password: 'password123',
        role: 'seller',
      });
      const thiefLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: thief.email, password: 'password123' });
      const thiefToken = extractToken(thiefLogin);

      const res = await request(app)
        .post('/api/products/upload-images')
        .set('Cookie', `access_token=${thiefToken}`)
        .attach('images', floppedBuffer, { filename: 'flipped.png', contentType: 'image/png' })
        .expect(409);

      expect(res.body.code).toBe('DUPLICATE_IMAGE');
    });
  });

  // ─── MobileNet label mapping precision ───

  describe('mapPredictionsToCategory (word-boundary matching)', () => {
    it('maps "cardigan" to Fashion, not Automotive via the substring "car"', () => {
      const result = mapPredictionsToCategory([{ className: 'cardigan', probability: 0.6 }]);
      expect(result.category).toBe('Fashion');
    });

    it('maps "bookcase" to Home & Garden, not Books & Media via the substring "book"', () => {
      const result = mapPredictionsToCategory([{ className: 'bookcase', probability: 0.7 }]);
      expect(result.category).toBe('Home & Garden');
    });

    it('maps multi-word labels correctly ("car wheel" → Automotive)', () => {
      const result = mapPredictionsToCategory([{ className: 'car wheel', probability: 0.8 }]);
      expect(result.category).toBe('Automotive');
    });

    it('maps hyphenated labels correctly ("t-shirt" → Fashion)', () => {
      const result = mapPredictionsToCategory([{ className: 'T-shirt', probability: 0.9 }]);
      expect(result.category).toBe('Fashion');
    });

    it('sums probabilities across predictions for the same category', () => {
      const result = mapPredictionsToCategory([
        { className: 'running shoe', probability: 0.4 },
        { className: 'sneaker', probability: 0.3 },
      ]);
      expect(result.category).toBe('Fashion');
      expect(result.confidence).toBe(0.7);
    });

    it('returns Other with 0 confidence when nothing matches', () => {
      const result = mapPredictionsToCategory([{ className: 'goblet chalice thingamajig', probability: 0.9 }]);
      expect(result.category).toBe('Other');
      expect(result.confidence).toBe(0);
    });
  });
});
