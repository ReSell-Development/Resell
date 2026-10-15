/**
 * ReDoS fix + minPrice=0 bug regression tests.
 *
 * Verifies that:
 *  1. Malicious regex-injection inputs are escaped and complete quickly
 *  2. Legitimate special characters in location/brand still match correctly
 *  3. minPrice=0 no longer silently ignores the filter (falsy-check bug)
 *  4. Empty string params are treated as absent (no filter), returning 200
 *  5. Truly malformed values (e.g. minPrice=abc) still correctly return 400
 */

const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');

// Helper: extract access_token from set-cookie header
const extractToken = (res) => {
  const setCookie = res.headers['set-cookie'] || [];
  const accessCookie = setCookie.find((c) => c.startsWith('access_token='));
  return accessCookie ? accessCookie.split(';')[0].split('=')[1] : null;
};

describe('ReDoS fix + minPrice=0 (productController filters)', () => {
  let sellerToken;
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
    const seller = await User.create({
      name: 'ReDoS Seller',
      email: `redos-${Date.now()}@example.com`,
      password: 'password123',
      role: 'seller',
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: seller.email, password: 'password123' });
    sellerToken = extractToken(loginRes);

    const category = await Category.create({
      name: 'ReDoS Category',
      slug: `redos-cat-${Date.now()}`,
      icon: 'package',
    });
    categoryId = category._id.toString();

    // Seed products with various prices and locations
    const products = [
      {
        title: 'Free Item',
        description: 'Something free',
        price: 0,
        category: categoryId,
        brand: "O'Brien",
        location: { city: 'St. Louis', state: 'MO', country: 'US' },
        images: [{ url: 'https://example.com/1.jpg', publicId: 'p1' }],
        seller: seller._id,
      },
      {
        title: 'Cheap Item',
        description: 'Something cheap',
        price: 5,
        category: categoryId,
        brand: 'TestBrand',
        location: { city: 'New York', state: 'NY', country: 'US' },
        images: [{ url: 'https://example.com/2.jpg', publicId: 'p2' }],
        seller: seller._id,
      },
      {
        title: 'Medium Item',
        description: 'Something medium',
        price: 50,
        category: categoryId,
        brand: 'TestBrand',
        location: { city: 'Los Angeles', state: 'CA', country: 'US' },
        images: [{ url: 'https://example.com/3.jpg', publicId: 'p3' }],
        seller: seller._id,
      },
      {
        title: 'Expensive Item',
        description: 'Something expensive',
        price: 500,
        category: categoryId,
        brand: 'PremiumBrand',
        location: { city: 'Chicago', state: 'IL', country: 'US' },
        images: [{ url: 'https://example.com/4.jpg', publicId: 'p4' }],
        seller: seller._id,
      },
    ];
    await Product.insertMany(products);
  });

  // ─── ReDoS: malicious inputs must not cause catastrophic backtracking ───

  describe('Malicious regex inputs in location filter', () => {
    it.each([
      ['(a+)+$', 'catastrophic backtracking pattern'],
      ['(.*)*', 'greedy star-star pattern'],
      ['(a|aa)+', 'alternation with overlap'],
      ['a{1,1000000}', 'large quantifier range'],
      ['(?=(a+)){2,}', 'nested lookahead'],
    ])('completes quickly with input "%s" (%s)', async (payload, desc) => {
      const start = Date.now();
      const res = await request(app)
        .get('/api/products')
        .query({ location: payload })
        .expect(200);
      const elapsed = Date.now() - start;

      expect(res.body.success).toBe(true);
      expect(res.body.items).toBeDefined();
      // Must complete well under 1 second — ReDoS would cause multi-second hangs
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('Malicious regex inputs in brand filter', () => {
    it.each([
      ['(a+)+$', 'catastrophic backtracking pattern'],
      ['(.*)*', 'greedy star-star pattern'],
    ])('completes quickly with input "%s" (%s)', async (payload, desc) => {
      const start = Date.now();
      const res = await request(app)
        .get('/api/products')
        .query({ brand: payload })
        .expect(200);
      const elapsed = Date.now() - start;

      expect(res.body.success).toBe(true);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  // ─── Legitimate special characters still match correctly ───

  describe('Legitimate special characters in location', () => {
    it('matches "St. Louis" (period in name)', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ location: 'St. Louis' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.items[0].location.city).toBe('St. Louis');
    });

    it('matches "O\'Brien" via brand filter (apostrophe)', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ brand: "O'Brien" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.items[0].brand).toBe("O'Brien");
    });

    it('matches partial location text (case-insensitive)', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ location: 'york' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.items[0].location.city).toBe('New York');
    });
  });

  // ─── minPrice=0 fix: the falsy-check bug ───

  describe('minPrice=0 (falsy-check regression)', () => {
    it('returns the free item when minPrice=0', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ minPrice: 0 })
        .expect(200);

      expect(res.body.success).toBe(true);
      // Should include the $0 item
      const prices = res.body.items.map((p) => p.price);
      expect(prices).toContain(0);
    });

    it('minPrice=0, maxPrice=0 returns only free items', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ minPrice: 0, maxPrice: 0 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      res.body.items.forEach((p) => {
        expect(p.price).toBe(0);
      });
    });

    it('minPrice=5 returns items priced >= 5', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ minPrice: 5 })
        .expect(200);

      expect(res.body.success).toBe(true);
      res.body.items.forEach((p) => {
        expect(p.price).toBeGreaterThanOrEqual(5);
      });
    });

    it('maxPrice=10 returns items priced <= 10', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ maxPrice: 10 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      res.body.items.forEach((p) => {
        expect(p.price).toBeLessThanOrEqual(10);
      });
    });
  });

  // ─── Empty/undefined price params fall through correctly ───

  describe('Empty/undefined price params', () => {
    it('no price params returns all items', async () => {
      const res = await request(app)
        .get('/api/products')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items.length).toBe(4);
    });

    it('empty string minPrice is treated as absent, returns all items', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ minPrice: '' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items.length).toBe(4);
    });

    it('empty string maxPrice is treated as absent, returns all items', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ maxPrice: '' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items.length).toBe(4);
    });

    it('empty string category is treated as absent, returns all items', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ category: '' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items.length).toBe(4);
    });

    it('empty string condition is treated as absent, returns all items', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ condition: '' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items.length).toBe(4);
    });
  });

  // ─── Truly malformed values still return 400 ───

  describe('Truly malformed query params', () => {
    it('non-numeric minPrice returns validation error', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ minPrice: 'abc' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('non-numeric maxPrice returns validation error', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ maxPrice: 'abc' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('invalid category ID returns validation error', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ category: 'not-a-valid-id' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('invalid condition returns validation error', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ condition: 'terrible' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('invalid sort option returns validation error', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ sort: 'random' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('negative minPrice returns validation error', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ minPrice: -5 })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
