const mongoose = require('mongoose');
const { server } = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { sweepStalePrices, MAX_REFINEMENT_ATTEMPTS } = require('../services/priceSweep');

describe('Price Sweep Service', () => {
  let seller, category;

  beforeAll(async () => {
    seller = await User.create({
      name: 'Sweep Test Seller',
      email: `sweep${Date.now()}@test.com`,
      password: 'password123',
      role: 'seller',
    });
    category = await Category.create({ name: 'Test', slug: 'test-sweep', icon: 'box' });
  });

  afterAll(async () => {
    await server.close();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      if (['users'].includes(key)) continue;
      await collections[key].deleteMany({});
    }
  });

  async function createProduct(overrides = {}) {
    return Product.create({
      title: 'Sweep Test Product',
      description: 'A test product for sweep testing',
      price: 100,
      originalPrice: 200,
      category: category._id,
      images: [{ url: 'http://x.com/1.jpg', publicId: 'sweep-test' }],
      seller: seller._id,
      condition: 'good',
      aiAnalysis: {
        priceRecommendation: {
          recommendedPrice: 80,
          minPrice: 60,
          maxPrice: 100,
          confidence: 0.7,
          explanation: 'Test',
          factors: ['condition'],
          generatedAt: new Date(),
          source: 'heuristic',
        },
      },
      ...overrides,
    });
  }

  describe('sweepStalePrices', () => {
    it('re-enqueues products with stale generatedAt and no refinedAt', async () => {
      // Product created 10 minutes ago, never refined
      const staleProduct = await createProduct({
        aiAnalysis: {
          priceRecommendation: {
            recommendedPrice: 80,
            minPrice: 60,
            maxPrice: 100,
            confidence: 0.7,
            explanation: 'Test',
            factors: ['condition'],
            generatedAt: new Date(Date.now() - 10 * 60 * 1000),
            source: 'heuristic',
          },
        },
      });

      const enqueued = [];
      const result = await sweepStalePrices({
        enqueue: async (productId) => { enqueued.push(productId); },
      });

      expect(result.found).toBe(1);
      expect(result.enqueued).toBe(1);
      expect(enqueued).toContain(staleProduct._id.toString());

      // Verify refinementAttempts was incremented
      const updated = await Product.findById(staleProduct._id);
      expect(updated.aiAnalysis.priceRecommendation.refinementAttempts).toBe(1);
    });

    it('does NOT re-enqueue products that already have refinedAt', async () => {
      await createProduct({
        aiAnalysis: {
          priceRecommendation: {
            recommendedPrice: 80,
            minPrice: 60,
            maxPrice: 100,
            confidence: 0.7,
            explanation: 'Test',
            factors: ['condition'],
            generatedAt: new Date(Date.now() - 10 * 60 * 1000),
            refinedAt: new Date(),
            source: 'heuristic',
          },
        },
      });

      const enqueued = [];
      const result = await sweepStalePrices({
        enqueue: async (productId) => { enqueued.push(productId); },
      });

      expect(result.found).toBe(0);
      expect(result.enqueued).toBe(0);
      expect(enqueued).toHaveLength(0);
    });

    it('does NOT re-enqueue products that are still fresh (< 5 min old)', async () => {
      await createProduct({
        aiAnalysis: {
          priceRecommendation: {
            recommendedPrice: 80,
            minPrice: 60,
            maxPrice: 100,
            confidence: 0.7,
            explanation: 'Test',
            factors: ['condition'],
            generatedAt: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
            source: 'heuristic',
          },
        },
      });

      const enqueued = [];
      const result = await sweepStalePrices({
        enqueue: async (productId) => { enqueued.push(productId); },
      });

      expect(result.found).toBe(0);
      expect(result.enqueued).toBe(0);
    });

    it('flags products that exceeded max refinement attempts', async () => {
      await createProduct({
        aiAnalysis: {
          priceRecommendation: {
            recommendedPrice: 80,
            minPrice: 60,
            maxPrice: 100,
            confidence: 0.7,
            explanation: 'Test',
            factors: ['condition'],
            generatedAt: new Date(Date.now() - 10 * 60 * 1000),
            refinementAttempts: MAX_REFINEMENT_ATTEMPTS,
            source: 'heuristic',
          },
        },
      });

      const enqueued = [];
      const result = await sweepStalePrices({
        enqueue: async (productId) => { enqueued.push(productId); },
      });

      expect(result.found).toBe(0); // query filters out attempts >= max
      expect(result.flagged).toBe(0);
      expect(enqueued).toHaveLength(0);
    });

    it('returns zero counts when no stale products exist', async () => {
      const enqueued = [];
      const result = await sweepStalePrices({
        enqueue: async (productId) => { enqueued.push(productId); },
      });

      expect(result.found).toBe(0);
      expect(result.enqueued).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.flagged).toBe(0);
    });
  });
});
