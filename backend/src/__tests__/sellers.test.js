const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Review = require('../models/Review');
const Sale = require('../models/Sale');
const { createUser } = require('./helpers');

describe('Seller Routes', () => {
  let sellerId, buyerToken, buyerId, otherBuyerToken, otherBuyerId, sellerToken;

  beforeAll(async () => {
    const seller = await createUser({ role: 'seller', email: 'sellerprofile@example.com' });
    sellerId = seller.user._id.toString();
    sellerToken = seller.token;
    const buyer = await createUser({ role: 'buyer', email: 'sellerbuyer@example.com' });
    buyerToken = buyer.token;
    buyerId = buyer.user._id.toString();
    const otherBuyer = await createUser({ role: 'buyer', email: 'otherbuyer@example.com' });
    otherBuyerToken = otherBuyer.token;
    otherBuyerId = otherBuyer.user._id.toString();
  });

  afterAll(async () => { await server.close(); });

  describe('GET /api/sellers/:id', () => {
    it('returns seller profile', async () => {
      const res = await request(app)
        .get(`/api/sellers/${sellerId}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.seller).toBeDefined();
    });

    it('returns 404 for non-existent seller', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      await request(app)
        .get(`/api/sellers/${fakeId}`)
        .expect(404);
    });
  });

  describe('GET /api/sellers/:id/trust', () => {
    it('returns trust score', async () => {
      const res = await request(app)
        .get(`/api/sellers/${sellerId}/trust`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.trust).toBeDefined();
      expect(typeof res.body.trust.score).toBe('number');
    });
  });

  describe('Verified-purchase review gating (POST /api/sellers/:id/reviews)', () => {
    let category, productId, otherProductId;

    beforeEach(async () => {
      const collections = mongoose.connection.collections;
      for (const key in collections) {
        if (['users'].includes(key)) continue;
        await collections[key].deleteMany({});
      }

      category = await Category.create({
        name: 'Review Cat',
        slug: `review-cat-${Date.now()}`,
        icon: 'box',
      });

      const product = await Product.create({
        title: 'Purchased Item',
        description: 'Item used for review tests',
        price: 100,
        category: category._id,
        images: [{ url: 'http://x.com/r.jpg', publicId: 'r' }],
        seller: sellerId,
        status: 'sold',
      });
      productId = product._id.toString();

      const other = await Product.create({
        title: 'Other Item',
        description: 'A different product',
        price: 200,
        category: category._id,
        images: [{ url: 'http://x.com/o.jpg', publicId: 'o' }],
        seller: sellerId,
        status: 'sold',
      });
      otherProductId = other._id.toString();
    });

    afterEach(async () => {
      const collections = mongoose.connection.collections;
      for (const key in collections) {
        if (['users'].includes(key)) continue;
        await collections[key].deleteMany({});
      }
    });

    const createSale = (overrides = {}) =>
      Sale.create({
        product: productId,
        seller: sellerId,
        buyer: buyerId,
        salePrice: 100,
        platformFee: 5,
        netAmount: 95,
        history: [{ status: 'delivered', actor: buyerId, at: new Date() }],
        ...overrides,
      });

    const postReview = (token, body = {}) =>
      request(app)
        .post(`/api/sellers/${sellerId}/reviews`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 5, comment: 'Great!', ...body });

    it('requires auth', async () => {
      await postReview(null).expect(401);
    });

    it('rejects a user with no purchase at all', async () => {
      const res = await postReview(otherBuyerToken).expect(403);
      expect(res.body.code).toBe('PURCHASE_REQUIRED');
      expect(await Review.countDocuments({})).toBe(0);
    });

    it('creates a review for a buyer with a qualifying delivered purchase', async () => {
      const sale = await createSale({ status: 'delivered' });

      const res = await postReview(buyerToken).expect(201);
      expect(res.body.success).toBe(true);

      const review = await Review.findById(res.body.review._id);
      expect(review.seller.toString()).toBe(sellerId);
      expect(review.buyer.toString()).toBe(buyerId);
      expect(review.product.toString()).toBe(productId);
      expect(review.sale.toString()).toBe(sale._id.toString());
      expect(review.rating).toBe(5);
    });

    it('also accepts a completed purchase', async () => {
      await createSale({ status: 'completed' });
      await postReview(buyerToken).expect(201);
    });

    it('rejects purchases that are not delivered/completed', async () => {
      for (const status of ['pending_payment', 'paid', 'shipped']) {
        await createSale({ status });
        const res = await postReview(buyerToken).expect(403);
        expect(res.body.code).toBe('PURCHASE_REQUIRED');
      }
      expect(await Review.countDocuments({})).toBe(0);
    });

    it('rejects a cancelled purchase', async () => {
      await createSale({ status: 'cancelled' });
      const res = await postReview(buyerToken).expect(403);
      expect(res.body.code).toBe('PURCHASE_REQUIRED');
    });

    it('rejects a refunded purchase', async () => {
      await createSale({ status: 'refunded' });
      await postReview(buyerToken).expect(403);
    });

    it('rejects a payment_failed purchase', async () => {
      await createSale({ status: 'payment_failed' });
      await postReview(buyerToken).expect(403);
    });

    it('rejects reviewing a product the buyer did not purchase', async () => {
      // Qualifying purchase exists — but for a different product
      await createSale({ status: 'delivered', product: otherProductId });

      const res = await postReview(buyerToken, { product: productId }).expect(403);
      expect(res.body.code).toBe('PURCHASE_REQUIRED');
      expect(await Review.countDocuments({})).toBe(0);
    });

    it('creates a product review when the purchase matches the product', async () => {
      const sale = await createSale({ status: 'delivered' });

      const res = await postReview(buyerToken, { product: productId }).expect(201);
      const review = await Review.findById(res.body.review._id);
      expect(review.product.toString()).toBe(productId);
      expect(review.sale.toString()).toBe(sale._id.toString());
    });

    it('rejects using another user’s purchase', async () => {
      // Sale belongs to buyerId, but otherBuyer tries to review
      await createSale({ status: 'delivered' });

      const res = await postReview(otherBuyerToken).expect(403);
      expect(res.body.code).toBe('PURCHASE_REQUIRED');
    });

    it('rejects a duplicate review for the same qualifying purchase', async () => {
      await createSale({ status: 'delivered' });

      await postReview(buyerToken).expect(201);
      const res = await postReview(buyerToken, { rating: 3 }).expect(409);
      expect(res.body.code).toBe('REVIEW_EXISTS');
      expect(await Review.countDocuments({})).toBe(1);
    });

    it('allows a second review after a second genuine purchase from the same seller', async () => {
      await createSale({ status: 'delivered', product: otherProductId });
      await createSale({ status: 'delivered' });

      await postReview(buyerToken, { product: otherProductId }).expect(201);
      await postReview(buyerToken, { product: productId }).expect(201);
      expect(await Review.countDocuments({ buyer: buyerId, seller: sellerId })).toBe(2);
    });

    it('rejects self-review', async () => {
      await createSale({ status: 'delivered', buyer: sellerId, product: productId });
      const res = await postReview(sellerToken).expect(400);
      expect(res.body.code).toBe('INVALID');
    });

    it('keeps seller trust/review calculations correct', async () => {
      await createSale({ status: 'delivered' });
      await postReview(buyerToken, { rating: 4 }).expect(201);

      const res = await request(app)
        .get(`/api/sellers/${sellerId}/trust`)
        .expect(200);
      expect(res.body.trust.breakdown.rating.count).toBe(1);
      expect(res.body.trust.breakdown.rating.average).toBe(4);
    });
  });

  describe('Product reviews retrieval (GET /api/products/:id/reviews)', () => {
    let category, productId;

    beforeEach(async () => {
      const collections = mongoose.connection.collections;
      for (const key in collections) {
        if (['users'].includes(key)) continue;
        await collections[key].deleteMany({});
      }

      category = await Category.create({
        name: 'PR Cat',
        slug: `pr-cat-${Date.now()}`,
        icon: 'box',
      });

      const product = await Product.create({
        title: 'Reviewed Item',
        description: 'Item for product review retrieval',
        price: 150,
        category: category._id,
        images: [{ url: 'http://x.com/pr.jpg', publicId: 'pr' }],
        seller: sellerId,
        status: 'sold',
      });
      productId = product._id.toString();
    });

    afterEach(async () => {
      const collections = mongoose.connection.collections;
      for (const key in collections) {
        if (['users'].includes(key)) continue;
        await collections[key].deleteMany({});
      }
    });

    const createDeliveredSale = (buyer) =>
      Sale.create({
        product: productId,
        seller: sellerId,
        buyer: buyer,
        salePrice: 150,
        platformFee: 8,
        netAmount: 142,
        status: 'delivered',
        history: [{ status: 'delivered', actor: buyer, at: new Date() }],
      });

    it('returns product reviews with summary', async () => {
      const sale = await createDeliveredSale(buyerId);
      await Review.create({
        seller: sellerId,
        buyer: buyerId,
        product: productId,
        sale: sale._id,
        rating: 5,
        comment: 'Exactly as described',
      });

      const res = await request(app)
        .get(`/api/products/${productId}/reviews`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.reviews).toHaveLength(1);
      expect(res.body.reviews[0].comment).toBe('Exactly as described');
      expect(res.body.reviews[0].buyer.name).toBeDefined();
      expect(res.body.summary.count).toBe(1);
      expect(res.body.summary.average).toBe(5);
    });

    it('reports eligibility for the requesting user', async () => {
      // Anonymous -> login required
      const anon = await request(app).get(`/api/products/${productId}/reviews`).expect(200);
      expect(anon.body.canReview).toEqual({ allowed: false, reason: 'login_required' });

      // Non-purchaser -> purchase required
      const other = await request(app)
        .get(`/api/products/${productId}/reviews`)
        .set('Authorization', `Bearer ${otherBuyerToken}`)
        .expect(200);
      expect(other.body.canReview).toEqual({ allowed: false, reason: 'purchase_required' });

      // Fresh purchaser -> allowed
      await createDeliveredSale(buyerId);
      const fresh = await request(app)
        .get(`/api/products/${productId}/reviews`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(fresh.body.canReview).toEqual({ allowed: true });

      // After reviewing -> already reviewed
      await request(app)
        .post(`/api/sellers/${sellerId}/reviews`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ rating: 5, comment: 'Nice', product: productId })
        .expect(201);

      const after = await request(app)
        .get(`/api/products/${productId}/reviews`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(after.body.canReview).toEqual({ allowed: false, reason: 'already_reviewed' });
      expect(after.body.reviews).toHaveLength(1);
    });

    it('returns 404 for an unknown product', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      await request(app)
        .get(`/api/products/${fakeId}/reviews`)
        .expect(404);
    });

    it('does not let the listing owner review their own item', async () => {
      const res = await request(app)
        .get(`/api/products/${productId}/reviews`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(res.body.canReview).toEqual({ allowed: false, reason: 'own_listing' });
    });
  });
});
