const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Sale = require('../models/Sale');
const Offer = require('../models/Offer');
const { createUser } = require('./helpers');

// Mock Stripe SDK
jest.mock('stripe', () => {
  const mockStripe = {
    refunds: {
      create: jest.fn().mockResolvedValue({ id: 're_test_mock123' }),
    },
  };
  return jest.fn(() => mockStripe);
});

describe('Order Routes', () => {
  let buyerToken, sellerToken, buyerId, sellerId, productId, category;

  beforeAll(async () => {
    const buyer = await createUser({ role: 'buyer', email: 'orderbuyer@example.com' });
    buyerToken = buyer.token;
    buyerId = buyer.user._id.toString();
    const seller = await createUser({ role: 'seller', email: 'orderseller@example.com' });
    sellerToken = seller.token;
    sellerId = seller.user._id.toString();
    category = await Category.create({ name: 'Test', slug: 'test-orders', icon: 'box' });
  });

  beforeEach(async () => {
    const product = await Product.create({
      title: 'Order Test Product',
      description: 'Test product for orders',
      price: 3000,
      category: category._id,
      images: [{ url: 'http://x.com/1.jpg', publicId: 'order-test' }],
      seller: sellerId,
      status: 'sold',
    });
    productId = product._id.toString();
  });

  afterAll(async () => { await server.close(); });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      if (['users'].includes(key)) continue;
      await collections[key].deleteMany({});
    }
  });

  async function createSale(overrides = {}) {
    return Sale.create({
      product: productId,
      seller: sellerId,
      buyer: buyerId,
      salePrice: 3000,
      platformFee: 150,
      netAmount: 2850,
      status: 'paid',
      stripePaymentIntentId: 'pi_test_order',
      paymentStatus: 'paid',
      history: [
        { status: 'pending_payment', actor: buyerId, at: new Date() },
        { status: 'paid', actor: null, at: new Date(), note: 'Payment confirmed' },
      ],
      ...overrides,
    });
  }

  describe('GET /api/orders/mine', () => {
    it('returns buyer orders', async () => {
      await createSale();
      const res = await request(app)
        .get('/api/orders/mine')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.orders.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/orders/selling', () => {
    it('returns seller sales', async () => {
      await createSale();
      const res = await request(app)
        .get('/api/orders/selling')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sales.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/orders/:id', () => {
    it('returns order for buyer', async () => {
      const sale = await createSale();
      const res = await request(app)
        .get(`/api/orders/${sale._id}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.order._id.toString()).toBe(sale._id.toString());
    });

    it('returns 403 for non-participant', async () => {
      const sale = await createSale();
      const other = await createUser({ role: 'buyer', email: 'other@example.com' });
      await request(app)
        .get(`/api/orders/${sale._id}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(403);
    });

    it('preserves the negotiated salePrice for an order created from an offer', async () => {
      const offer = await Offer.create({
        product: productId,
        buyer: buyerId,
        seller: sellerId,
        amount: 2400,
        currencyCode: 'USD',
        status: 'accepted',
        history: [{ status: 'accepted', actor: sellerId, at: new Date() }],
      });

      const sale = await createSale({
        offer: offer._id,
        salePrice: 2400,
        platformFee: 120,
        netAmount: 2280,
      });

      const res = await request(app)
        .get(`/api/orders/${sale._id}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.order.salePrice).toBe(2400);
      expect(res.body.order.platformFee).toBe(120);
      expect(res.body.order.netAmount).toBe(2280);
      expect(res.body.order.offer.toString()).toBe(offer._id.toString());
      // Listed price is NOT what the buyer paid
      expect(res.body.order.salePrice).not.toBe(3000);
    });
  });

  describe('PATCH /api/orders/:id/ship', () => {
    it('allows seller to ship paid order', async () => {
      const sale = await createSale();
      const res = await request(app)
        .patch(`/api/orders/${sale._id}/ship`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ trackingNumber: 'TRACK123' })
        .expect(200);
      expect(res.body.order.status).toBe('shipped');
      expect(res.body.order.trackingNumber).toBe('TRACK123');
    });

    it('rejects buyer from shipping', async () => {
      const sale = await createSale();
      await request(app)
        .patch(`/api/orders/${sale._id}/ship`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({})
        .expect(403);
    });

    it('rejects shipping pending_payment order', async () => {
      const sale = await createSale({ status: 'pending_payment', paymentStatus: 'unpaid', stripePaymentIntentId: null });
      await request(app)
        .patch(`/api/orders/${sale._id}/ship`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({})
        .expect(400);
    });
  });

  describe('PATCH /api/orders/:id/deliver', () => {
    it('allows buyer to confirm delivery of shipped order', async () => {
      const sale = await createSale({
        status: 'shipped',
        history: [
          { status: 'pending_payment', actor: buyerId, at: new Date() },
          { status: 'paid', actor: null, at: new Date() },
          { status: 'shipped', actor: sellerId, at: new Date() },
        ],
      });
      const res = await request(app)
        .patch(`/api/orders/${sale._id}/deliver`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body.order.status).toBe('delivered');
    });

    it('rejects seller from confirming delivery', async () => {
      const sale = await createSale({
        status: 'shipped',
        history: [
          { status: 'pending_payment', actor: buyerId, at: new Date() },
          { status: 'paid', actor: null, at: new Date() },
          { status: 'shipped', actor: sellerId, at: new Date() },
        ],
      });
      await request(app)
        .patch(`/api/orders/${sale._id}/deliver`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(403);
    });
  });

  describe('POST /api/orders/:id/cancel', () => {
    it('cancels pending_payment order and releases product', async () => {
      const sale = await createSale({ status: 'pending_payment', paymentStatus: 'unpaid', stripePaymentIntentId: null });
      await Product.findByIdAndUpdate(productId, { status: 'pending' });

      await request(app)
        .post(`/api/orders/${sale._id}/cancel`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);

      const product = await Product.findById(productId);
      expect(product.status).toBe('active');

      const updatedSale = await Sale.findById(sale._id);
      expect(updatedSale.status).toBe('cancelled');
    });

    it('refunds paid order via Stripe', async () => {
      const sale = await createSale();
      const res = await request(app)
        .post(`/api/orders/${sale._id}/cancel`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.order.status).toBe('refunded');
      expect(res.body.order.stripeRefundId).toBe('re_test_mock123');

      // Product should be released
      const product = await Product.findById(productId);
      expect(product.status).toBe('active');
    });

    it('rejects cancelling shipped order', async () => {
      const sale = await createSale({
        status: 'shipped',
        history: [
          { status: 'pending_payment', actor: buyerId, at: new Date() },
          { status: 'paid', actor: null, at: new Date() },
          { status: 'shipped', actor: sellerId, at: new Date() },
        ],
      });
      await request(app)
        .post(`/api/orders/${sale._id}/cancel`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(400);
    });
  });

  describe('Sale model state machine', () => {
    it('validates transitions correctly', async () => {
      const sale = await createSale();
      expect(sale.canTransition('shipped')).toBe(true);
      expect(sale.canTransition('delivered')).toBe(false);
      expect(sale.canTransition('completed')).toBe(false);
      expect(sale.canTransition('cancelled')).toBe(true);
    });

    it('rejects invalid transitions', async () => {
      const sale = await createSale({ status: 'completed' });
      expect(sale.canTransition('pending_payment')).toBe(false);
      expect(sale.canTransition('shipped')).toBe(false);
    });
  });
});
