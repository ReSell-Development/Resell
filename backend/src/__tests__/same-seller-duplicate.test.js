/**
 * Object-centric same-seller duplicate detection.
 *
 * Crop-vs-crop (mocked embeddings) — background pixels never enter the
 * comparison. Guard rails: self-edit is clean; a sold prior is
 * DOUBLE_SELLING (+30); an active prior is SAME_SELLER_RELIST (+25).
 */

const mongoose = require('mongoose');
const { server } = require('../server');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { detectRisk, assessSameSellerDuplicate } = require('../services/fraudDetection');
const {
  cosineSimilarity,
  compareObjectCentric,
  decideSameSellerMatch,
  SAME_SELLER_SIM_THRESHOLD,
} = require('../services/productFingerprint');

const unit = (x, y) => {
  const n = Math.sqrt(x * x + y * y);
  return [x / n, y / n];
};
// Cosine([1,0], SCENE) = 0.9; cosine([1,0], OTHER) = 0.7
const ANCHOR = [1, 0];
const SAME_PRODUCT_SCENE = unit(0.9, Math.sqrt(1 - 0.9 * 0.9));
const DIFFERENT_PRODUCT = unit(0.7, Math.sqrt(1 - 0.7 * 0.7));

describe('Object-centric same-seller duplicate detection', () => {
  let seller;
  let categoryId;

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
    seller = await User.create({
      name: 'Object Seller',
      email: `obj-${Date.now()}@example.com`,
      password: 'password123',
      role: 'seller',
      createdAt: new Date(Date.now() - 365 * 86400000),
    });
    const category = await Category.create({
      name: `Bottles ${Date.now()}`,
      slug: `bottles-${Date.now()}`,
      icon: 'package',
    });
    categoryId = category._id;
  });

  const listing = ({ title, crop, status = 'active', sellerId, colorHistogram }) =>
    Product.create({
      title,
      description: `${title} ${new mongoose.Types.ObjectId()}`,
      price: 40,
      originalPrice: 80,
      category: categoryId,
      seller: sellerId || seller._id,
      status,
      images: [{ url: `https://example.com/${title}.jpg`, publicId: title }],
      aiAnalysis: {
        detectedObjects: [
          {
            label: 'bottle',
            score: 0.94,
            cropClassification: 'Electronics',
            cropConfidence: 0.8,
            cropEmbedding: crop,
            clipCropEmbedding: crop,
            colorHistogram: colorHistogram || [],
          },
        ],
      },
    });

  it('crop cosine of identical unit vectors is 1 and SAME_SELLER_SIM_THRESHOLD defaults to 0.82', () => {
    expect(cosineSimilarity(ANCHOR, ANCHOR)).toBe(1);
    expect(cosineSimilarity(ANCHOR, SAME_PRODUCT_SCENE)).toBeCloseTo(0.9, 5);
    expect(cosineSimilarity(ANCHOR, DIFFERENT_PRODUCT)).toBeCloseTo(0.7, 5);
    expect(SAME_SELLER_SIM_THRESHOLD).toBe(0.82);
  });

  it('same product two scenes (crop cosine 0.9) fires SAME_SELLER_RELIST', async () => {
    const prior = await listing({ title: 'Bottle on kitchen counter', crop: ANCHOR });
    const current = await listing({ title: 'Bottle on office desk', crop: SAME_PRODUCT_SCENE });

    const comparison = compareObjectCentric(
      await Product.findById(current._id).lean(),
      await Product.findById(prior._id).lean()
    );
    expect(comparison.bothHaveCrops).toBe(true);
    expect(comparison.cropSimilarity).toBeCloseTo(0.9, 5);
    expect(comparison.similarity).toBe(comparison.cropSimilarity);
    expect(decideSameSellerMatch(comparison).matched).toBe(true);

    const result = await detectRisk({
      product: await Product.findById(current._id).lean(),
      hashes: [],
      aiAnalysis: {},
    });
    expect(result.factors.some((f) => f.includes('SAME_SELLER_RELIST'))).toBe(true);
    expect(result.riskScore).toBeGreaterThanOrEqual(25);
  });

  it('DOUBLE_SELLING fires when the matched prior is sold', async () => {
    await listing({ title: 'Sold bottle', crop: ANCHOR, status: 'sold' });
    const current = await listing({ title: 'Relisted bottle', crop: SAME_PRODUCT_SCENE });
    const match = await assessSameSellerDuplicate({
      product: await Product.findById(current._id).lean(),
    });
    expect(match.signal).toBe('DOUBLE_SELLING');
    expect(match.weight).toBe(30);
  });

  it('different product same category (crop cosine 0.7) is clean', async () => {
    await listing({ title: 'Blue bottle', crop: ANCHOR });
    const current = await listing({ title: 'Green tumbler', crop: DIFFERENT_PRODUCT });
    const result = await detectRisk({
      product: await Product.findById(current._id).lean(),
      hashes: [],
      aiAnalysis: {},
    });
    expect(result.factors.some((f) => /SAME_SELLER_RELIST|DOUBLE_SELLING/.test(f))).toBe(false);
  });

  it('self-edit (same productId) is clean', async () => {
    const current = await listing({ title: 'Only bottle', crop: ANCHOR });
    const match = await assessSameSellerDuplicate({
      product: await Product.findById(current._id).lean(),
    });
    expect(match).toBeNull();

    const result = await detectRisk({
      product: await Product.findById(current._id).lean(),
      hashes: [],
      aiAnalysis: {},
      excludeProductId: current._id,
    });
    expect(result.factors.some((f) => /SAME_SELLER_RELIST|DOUBLE_SELLING/.test(f))).toBe(false);
  });

  it('HSV second modality fires when crop cosine is 0.78 and colour corr is 0.85+', async () => {
    const hist = new Array(48).fill(0);
    hist[0] = 1;
    hist[16] = 1;
    hist[32] = 1;
    const mid = unit(0.78, Math.sqrt(1 - 0.78 * 0.78));
    await listing({ title: 'Colour prior', crop: ANCHOR, colorHistogram: hist });
    const current = await listing({
      title: 'Colour current',
      crop: mid,
      colorHistogram: hist,
    });
    const comparison = compareObjectCentric(
      await Product.findById(current._id).lean(),
      await Product.findById((await Product.findOne({ title: 'Colour prior' }))._id).lean()
    );
    expect(comparison.cropSimilarity).toBeCloseTo(0.78, 5);
    expect(comparison.colorCorr).toBeGreaterThanOrEqual(0.85);
    expect(decideSameSellerMatch(comparison).matched).toBe(true);
    expect(decideSameSellerMatch(comparison).reason).toBe('crop+color');
  });
});
