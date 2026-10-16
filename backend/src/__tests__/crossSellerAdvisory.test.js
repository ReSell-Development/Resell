/**
 * Cross-seller visual-similarity buyer advisory.
 *
 * Two sellers, same-model bottle: the second listing's cross-seller visual
 * scan fires -> the Trust panel advisory line is stored (evidence phrasing,
 * never "fraud"/"duplicate"), risk stays low/medium, and NEITHER listing is
 * auto-rejected (status untouched). A very strong match (>= 0.97) with >= 2
 * other signals escalates an otherwise-low listing to medium + admin flagged
 * queue.
 */

const mongoose = require('mongoose');
const { server } = require('../server');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { assessVisualSimilarity } = require('../services/fraudDetection');
const {
  BUYER_ADVISORY_TEXT,
  buildBuyerAdvisory,
  countOtherSignals,
  needsMediumEscalation,
  applyCrossSellerVisualOutcome,
} = require('../services/visualAdvisory');

const unit = (x, y) => {
  const n = Math.sqrt(x * x + y * y);
  return [x / n, y / n];
};
const ANCHOR = [1, 0];
// cosine 0.98 with ANCHOR (strong band); 0.91 (advisory band); 0.85 (clean)
const STRONG_MATCH = unit(0.98, Math.sqrt(1 - 0.98 * 0.98));
const MEDIUM_MATCH = unit(0.91, Math.sqrt(1 - 0.91 * 0.91));
const NO_MATCH = unit(0.85, Math.sqrt(1 - 0.85 * 0.85));

describe('Cross-seller visual similarity buyer advisory', () => {
  let sellerA;
  let sellerB;
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
    sellerA = await User.create({
      name: 'Bottle Seller A',
      email: `bottlea-${Date.now()}@example.com`,
      password: 'password123',
      role: 'seller',
      createdAt: new Date(Date.now() - 90 * 86400000),
    });
    sellerB = await User.create({
      name: 'Bottle Seller B',
      email: `bottleb-${Date.now()}@example.com`,
      password: 'password123',
      role: 'seller',
      createdAt: new Date(Date.now() - 90 * 86400000),
    });
    const category = await Category.create({
      name: `Bottles ${Date.now()}`,
      slug: `bottles-${Date.now()}`,
      icon: 'package',
    });
    categoryId = category._id;
  });

  const bottleListing = ({ title, sellerId, crop, riskAssessment }) =>
    Product.create({
      title,
      description: `${title} genuine steel bottle ${new mongoose.Types.ObjectId()}`,
      price: 500,
      originalPrice: 1200,
      category: categoryId,
      seller: sellerId,
      status: 'active',
      images: [{ url: `https://example.com/${title}.jpg`, publicId: title }],
      aiAnalysis: {
        detectedObjects: [
          {
            label: 'bottle',
            score: 0.94,
            cropClassification: 'Home & Garden',
            cropConfidence: 0.8,
            cropEmbedding: crop,
            clipCropEmbedding: [],
            colorHistogram: [],
          },
        ],
        riskAssessment: riskAssessment || {
          riskScore: 0,
          riskLevel: 'low',
          factors: [],
          assessedAt: new Date(),
        },
      },
    });

  it('stores the exact evidence-phrased advisory (never "fraud"/"duplicate")', () => {
    expect(buildBuyerAdvisory(0.95)).toBe(BUYER_ADVISORY_TEXT);
    expect(buildBuyerAdvisory(0.899)).toBe('');
    expect(buildBuyerAdvisory(null)).toBe('');
    expect(BUYER_ADVISORY_TEXT).toBe(
      '⚠️ Visually similar to another active listing — we recommend verifying details with the seller before paying'
    );
    expect(BUYER_ADVISORY_TEXT).not.toMatch(/fraud|duplicate/i);
  });

  it('counts only non-visual factors toward the escalation quorum', () => {
    expect(
      countOtherSignals([
        'Price is suspiciously low (<15% of original price)',
        'Visual product similarity to another listing — supporting evidence only (same model is not fraud)',
      ])
    ).toBe(1);
    expect(
      needsMediumEscalation({ similarity: 0.98, otherSignalCount: 2, riskLevel: 'low' })
    ).toBe(true);
    expect(
      needsMediumEscalation({ similarity: 0.95, otherSignalCount: 3, riskLevel: 'low' })
    ).toBe(false);
    expect(
      needsMediumEscalation({ similarity: 0.98, otherSignalCount: 1, riskLevel: 'low' })
    ).toBe(false);
    expect(
      needsMediumEscalation({ similarity: 0.98, otherSignalCount: 2, riskLevel: 'medium' })
    ).toBe(false);
  });

  it('two sellers, same-model bottle: listing 2 gets the advisory, risk stays low, neither auto-rejected', async () => {
    await bottleListing({ title: 'Steel bottle seller A', sellerId: sellerA._id, crop: ANCHOR });
    const second = await bottleListing({
      title: 'Steel bottle seller B',
      sellerId: sellerB._id,
      crop: MEDIUM_MATCH,
    });

    const visual = await assessVisualSimilarity({ productId: second._id });
    expect(visual.available).toBe(true);
    expect(visual.signal).toBe('VISUAL_PRODUCT_SIMILARITY');
    expect(visual.similarity).toBeGreaterThanOrEqual(0.9);
    expect(visual.similarity).toBeLessThan(0.97);

    const outcome = await applyCrossSellerVisualOutcome({
      productId: second._id,
      similarity: visual.similarity,
    });
    expect(outcome.advisory).toBe(BUYER_ADVISORY_TEXT);
    expect(outcome.escalated).toBe(false);

    const stored = await Product.findById(second._id).lean();
    expect(stored.buyerAdvisory).toBe(BUYER_ADVISORY_TEXT);
    expect(stored.aiAnalysis.riskAssessment.riskLevel).toBe('low');
    expect(stored.isFlagged).toBe(false);
    expect(stored.status).toBe('active');

    const first = await Product.findOne({ title: 'Steel bottle seller A' }).lean();
    expect(first.status).toBe('active');
    expect(first.buyerAdvisory || '').toBe('');
  });

  it('strong match + 2 other signals: medium + admin flagged queue, still not auto-rejected', async () => {
    await bottleListing({ title: 'Steel bottle seller A', sellerId: sellerA._id, crop: ANCHOR });
    const second = await bottleListing({
      title: 'Steel bottle seller B',
      sellerId: sellerB._id,
      crop: STRONG_MATCH,
      riskAssessment: {
        riskScore: 10,
        riskLevel: 'low',
        factors: [
          'Price is significantly above original price',
          'CATEGORY_MISMATCH: listing category disagrees with the image',
        ],
        assessedAt: new Date(),
      },
    });

    const visual = await assessVisualSimilarity({ productId: second._id });
    expect(visual.signal).toBe('VISUAL_PRODUCT_SIMILARITY');
    expect(visual.similarity).toBeGreaterThanOrEqual(0.97);

    const outcome = await applyCrossSellerVisualOutcome({
      productId: second._id,
      similarity: visual.similarity,
    });
    expect(outcome.escalated).toBe(true);
    expect(outcome.otherSignalCount).toBe(2);

    const stored = await Product.findById(second._id).lean();
    expect(stored.buyerAdvisory).toBe(BUYER_ADVISORY_TEXT);
    expect(stored.aiAnalysis.riskAssessment.riskScore).toBe(25);
    expect(stored.aiAnalysis.riskAssessment.riskLevel).toBe('medium');
    expect(stored.isFlagged).toBe(true);
    expect(stored.flagReason).toMatch(/review advised/);
    // Flagged for the admin queue — NOT rejected/removed/pendingReview.
    expect(stored.status).toBe('active');
  });

  it('below-threshold similarity stores no advisory and changes nothing', async () => {
    await bottleListing({ title: 'Steel bottle seller A', sellerId: sellerA._id, crop: ANCHOR });
    const second = await bottleListing({
      title: 'Steel bottle seller B',
      sellerId: sellerB._id,
      crop: NO_MATCH,
    });

    const visual = await assessVisualSimilarity({ productId: second._id });
    expect(visual.signal).toBeNull();

    const outcome = await applyCrossSellerVisualOutcome({
      productId: second._id,
      similarity: visual.similarity,
    });
    expect(outcome).toEqual({ advisory: '', escalated: false, otherSignalCount: 0 });

    const stored = await Product.findById(second._id).lean();
    expect(stored.buyerAdvisory || '').toBe('');
    expect(stored.isFlagged).toBe(false);
  });
});
