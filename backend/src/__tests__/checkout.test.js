const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Sale = require('../models/Sale');
const { createUser } = require('./helpers');

// Mock Stripe SDK
jest.mock('stripe', () => {
  const mockStripe = {
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: 'cs_test_mock123',
          url: 'https://checkout.stripe.com/test',
          payment_intent: 'pi_test_mock123',
        }),
      },
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
    refunds: {
      create: jest.fn().mockResolvedValue({ id: 're_test_mock123' }),
    },
  };
  return jest.fn(() => mockStripe);
});

describe('Checkout Routes', () => {
  let buyerToken, sellerToken, sellerId, productId, category;

  beforeAll(async () => {
    const buyer = await createUser({ role: 'buyer', email: 'checkoutbuyer@example.com' });
    buyerToken = buyer.token;
    const seller = await createUser({ role: 'seller', email: 'checkoutseller@example.com' });
    sellerToken = seller.token;
    sellerId = seller.user._id.toString();
  });

  beforeEach(async () => {
    category = await Category.create({ name: 'Test', slug: `test-checkout-${Date.now()}`, icon: 'box' });
    const product = await Product.create({
      title: 'Checkout Test Product',
      description: 'Test product for checkout',
      price: 5000,
      category: category._id,
      images: [{ url: 'http://x.com/1.jpg', publicId: 'checkout-test' }],
      seller: sellerId,
      status: 'active',
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

  describe('POST /api/checkout/session', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app)
        .post('/api/checkout/session')
        .send({ productId })
        .expect(401);
    });

    it('creates checkout session for valid product', async () => {
      const res = await request(app)
        .post('/api/checkout/session')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ productId })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.url).toContain('checkout.stripe.com');
      expect(res.body.saleId).toBeDefined();

      // Product should be marked as pending
      const product = await Product.findById(productId);
      expect(product.status).toBe('pending');

      // Sale should exist in pending_payment
      const sale = await Sale.findById(res.body.saleId);
      expect(sale.status).toBe('pending_payment');
      expect(sale.stripeSessionId).toBe('cs_test_mock123');
    });

    it('returns 409 for already-sold product', async () => {
      await Product.findByIdAndUpdate(productId, { status: 'sold' });
      await request(app)
        .post('/api/checkout/session')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ productId })
        .expect(409);
    });

    it('prevents seller from buying own product', async () => {
      await request(app)
        .post('/api/checkout/session')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ productId })
        .expect(400);
    });
  });

  describe('POST /api/checkout/webhook', () => {
    it('rejects invalid webhook signature', async () => {
      const stripe = require('stripe')();
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await request(app)
        .post('/api/checkout/webhook')
        .set('stripe-signature', 'invalid')
        .send({})
        .expect(400);
    });

    it('handles checkout.session.completed idempotently', async () => {
      // Create a sale in pending_payment
      const sale = await Sale.create({
        product: productId,
        seller: sellerId,
        buyer: new mongoose.Types.ObjectId(),
        salePrice: 5000,
        netAmount: 4750,
        status: 'pending_payment',
        stripeSessionId: 'cs_test_idempotent',
        history: [{ status: 'pending_payment', actor: new mongoose.Types.ObjectId(), at: new Date() }],
      });

      const stripe = require('stripe')();
      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_idempotent',
            payment_intent: 'pi_test_123',
            metadata: {
              productId,
              buyerId: sale.buyer.toString(),
              sellerId,
            },
          },
        },
      });

      // First webhook call
      const res1 = await request(app)
        .post('/api/checkout/webhook')
        .set('stripe-signature', 'valid')
        .send({})
        .expect(200);

      expect(res1.body.result.processed).toBe(true);

      // Second webhook call (same event) — should be idempotent
      const res2 = await request(app)
        .post('/api/checkout/webhook')
        .set('stripe-signature', 'valid')
        .send({})
        .expect(200);

      expect(res2.body.result.processed).toBe(false);
      expect(res2.body.result.reason).toBe('already_processed');

      // Product should still be sold (not double-released)
      const product = await Product.findById(productId);
      expect(product.status).toBe('sold');
    });
  });
});
