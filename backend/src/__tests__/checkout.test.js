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
  let buyerToken, sellerToken, buyerId, sellerId, productId, category;

  beforeAll(async () => {
    const buyer = await createUser({ role: 'buyer', email: 'checkoutbuyer@example.com' });
    buyerToken = buyer.token;
    buyerId = buyer.user._id.toString();
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

    // Keep per-call assertions accurate across tests in this file
    const stripe = require('stripe')();
    stripe.checkout.sessions.create.mockClear();
    stripe.refunds.create.mockClear();
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

  describe('POST /api/checkout/session with an accepted offer', () => {
    const createAcceptedOffer = (overrides = {}) =>
      Offer.create({
        product: productId,
        buyer: buyerId,
        seller: sellerId,
        amount: 4000,
        currencyCode: 'USD',
        status: 'accepted',
        history: [{ status: 'accepted', actor: sellerId, at: new Date() }],
        ...overrides,
      });

    const createSession = (token, body) =>
      request(app).post('/api/checkout/session').set('Authorization', `Bearer ${token}`).send(body);

    it('uses the negotiated offer amount for the charge, fee and sale', async () => {
      const offer = await createAcceptedOffer();

      const res = await createSession(buyerToken, { productId, offerId: offer._id.toString() }).expect(201);
      expect(res.body.success).toBe(true);

      const stripe = require('stripe')();
      const sessionArgs = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(sessionArgs.line_items[0].price_data.unit_amount).toBe(4000);
      expect(sessionArgs.metadata.offerId).toBe(offer._id.toString());

      const sale = await Sale.findById(res.body.saleId);
      expect(sale.salePrice).toBe(4000);
      expect(sale.platformFee).toBe(200);
      expect(sale.netAmount).toBe(3800);
      expect(sale.offer.toString()).toBe(offer._id.toString());
    });

    it('rejects a user who is not the offer buyer', async () => {
      const offer = await createAcceptedOffer();
      const third = await createUser({ role: 'buyer', email: 'checkoutthird@example.com' });
      const res = await createSession(third.token, { productId, offerId: offer._id.toString() }).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('rejects an offer that is not accepted', async () => {
      const offer = await createAcceptedOffer({ status: 'pending' });
      const res = await createSession(buyerToken, { productId, offerId: offer._id.toString() }).expect(409);
      expect(res.body.code).toBe('OFFER_NOT_ACCEPTED');
    });

    it('rejects an offer that applies to a different product', async () => {
      const other = await Product.create({
        title: 'Other Product',
        description: 'Other',
        price: 1000,
        category: category._id,
        images: [{ url: 'http://x.com/2.jpg', publicId: 'other' }],
        seller: sellerId,
        status: 'active',
      });
      // Offer targets `other`, but the checkout request is for the original product
      const offer = await createAcceptedOffer({ product: other._id });

      const res = await createSession(buyerToken, { productId, offerId: offer._id.toString() }).expect(400);
      expect(res.body.code).toBe('OFFER_PRODUCT_MISMATCH');
    });

    it('rejects an offer whose seller does not match the product seller', async () => {
      const offer = await createAcceptedOffer({ seller: buyerId });
      const res = await createSession(buyerToken, { productId, offerId: offer._id.toString() }).expect(400);
      expect(res.body.code).toBe('OFFER_SELLER_MISMATCH');
    });

    it('rejects a currency mismatch between offer and product', async () => {
      const offer = await createAcceptedOffer({ currencyCode: 'EUR' });
      const res = await createSession(buyerToken, { productId, offerId: offer._id.toString() }).expect(400);
      expect(res.body.code).toBe('CURRENCY_MISMATCH');
    });

    it('rejects an unknown offer id', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await createSession(buyerToken, { productId, offerId: fakeId }).expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('rejects an offer already consumed by a paid sale', async () => {
      const offer = await createAcceptedOffer();
      await Sale.create({
        product: productId,
        seller: sellerId,
        buyer: buyerId,
        offer: offer._id,
        salePrice: 4000,
        platformFee: 200,
        netAmount: 3800,
        status: 'paid',
        history: [{ status: 'paid', actor: null, at: new Date() }],
      });

      const res = await createSession(buyerToken, { productId, offerId: offer._id.toString() }).expect(409);
      expect(res.body.code).toBe('OFFER_ALREADY_CONSUMED');
    });

    it('rejects an invalid (non-ObjectId) offerId', async () => {
      await createSession(buyerToken, { productId, offerId: 'not-an-id' }).expect(400);
    });

    it('keeps product-price checkout when no offerId is supplied', async () => {
      const res = await createSession(buyerToken, { productId }).expect(201);

      const stripe = require('stripe')();
      const sessionArgs = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(sessionArgs.line_items[0].price_data.unit_amount).toBe(5000);
      expect(sessionArgs.metadata.offerId).toBeUndefined();

      const sale = await Sale.findById(res.body.saleId);
      expect(sale.salePrice).toBe(5000);
      expect(sale.platformFee).toBe(250);
      expect(sale.netAmount).toBe(4750);
      expect(sale.offer).toBeNull();
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
            amount_total: 5000,
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

    it('marks a sale paid when the amount matches the negotiated offer price', async () => {
      const offer = await Offer.create({
        product: productId,
        buyer: buyerId,
        seller: sellerId,
        amount: 4000,
        currencyCode: 'USD',
        status: 'accepted',
        history: [{ status: 'accepted', actor: sellerId, at: new Date() }],
      });

      const sale = await Sale.create({
        product: productId,
        seller: sellerId,
        buyer: buyerId,
        offer: offer._id,
        salePrice: 4000,
        platformFee: 200,
        netAmount: 3800,
        status: 'pending_payment',
        stripeSessionId: 'cs_test_offer_paid',
        history: [{ status: 'pending_payment', actor: buyerId, at: new Date() }],
      });

      const stripe = require('stripe')();
      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_offer_paid',
            payment_intent: 'pi_test_offer',
            amount_total: 4000,
            metadata: { productId, buyerId, sellerId, offerId: offer._id.toString() },
          },
        },
      });

      const res = await request(app)
        .post('/api/checkout/webhook')
        .set('stripe-signature', 'valid')
        .send({})
        .expect(200);
      expect(res.body.result.processed).toBe(true);

      const paid = await Sale.findById(sale._id);
      expect(paid.status).toBe('paid');
      expect(paid.paymentStatus).toBe('paid');
      expect(paid.salePrice).toBe(4000);
      expect(paid.offer.toString()).toBe(offer._id.toString());

      // Product was held 'pending' by our checkout — webhook must still complete
      const product = await Product.findById(productId);
      expect(product.status).toBe('sold');
    });

    it('marks a sale paid when the product is pending (held by this checkout)', async () => {
      await Product.findByIdAndUpdate(productId, { status: 'pending' });
      await Sale.create({
        product: productId,
        seller: sellerId,
        buyer: buyerId,
        salePrice: 5000,
        netAmount: 4750,
        status: 'pending_payment',
        stripeSessionId: 'cs_test_pending_product',
        history: [{ status: 'pending_payment', actor: buyerId, at: new Date() }],
      });

      const stripe = require('stripe')();
      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_pending_product',
            payment_intent: 'pi_test_pending',
            amount_total: 5000,
            metadata: { productId, buyerId, sellerId },
          },
        },
      });

      const res = await request(app)
        .post('/api/checkout/webhook')
        .set('stripe-signature', 'valid')
        .send({})
        .expect(200);
      expect(res.body.result.processed).toBe(true);

      expect((await Product.findById(productId)).status).toBe('sold');
    });

    it('does not mark the sale paid on amount mismatch and refunds', async () => {
      const sale = await Sale.create({
        product: productId,
        seller: sellerId,
        buyer: buyerId,
        salePrice: 4000,
        platformFee: 200,
        netAmount: 3800,
        status: 'pending_payment',
        stripeSessionId: 'cs_test_mismatch',
        history: [{ status: 'pending_payment', actor: buyerId, at: new Date() }],
      });

      const stripe = require('stripe')();
      stripe.refunds.create.mockClear();
      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_mismatch',
            payment_intent: 'pi_test_mismatch',
            amount_total: 5000, // charged list price, sale was for 4000
            metadata: { productId, buyerId, sellerId },
          },
        },
      });

      const res = await request(app)
        .post('/api/checkout/webhook')
        .set('stripe-signature', 'valid')
        .send({})
        .expect(200);
      expect(res.body.result.processed).toBe(false);
      expect(res.body.result.reason).toBe('amount_mismatch');

      const failed = await Sale.findById(sale._id);
      expect(failed.status).toBe('payment_failed');
      expect(failed.paymentStatus).toBe('failed');
      expect(failed.salePrice).toBe(4000);

      expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_test_mismatch' });

      // Product lock held by this sale is released
      expect((await Product.findById(productId)).status).toBe('active');
    });

    it('blocks reusing an offer after its sale is paid', async () => {
      const offer = await Offer.create({
        product: productId,
        buyer: buyerId,
        seller: sellerId,
        amount: 4000,
        currencyCode: 'USD',
        status: 'accepted',
        history: [{ status: 'accepted', actor: sellerId, at: new Date() }],
      });

      const sale = await Sale.create({
        product: productId,
        seller: sellerId,
        buyer: buyerId,
        offer: offer._id,
        salePrice: 4000,
        platformFee: 200,
        netAmount: 3800,
        status: 'pending_payment',
        stripeSessionId: 'cs_test_reuse',
        history: [{ status: 'pending_payment', actor: buyerId, at: new Date() }],
      });

      const stripe = require('stripe')();
      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_reuse',
            payment_intent: 'pi_test_reuse',
            amount_total: 4000,
            metadata: { productId, buyerId, sellerId, offerId: offer._id.toString() },
          },
        },
      });

      await request(app)
        .post('/api/checkout/webhook')
        .set('stripe-signature', 'valid')
        .send({})
        .expect(200);

      expect((await Sale.findById(sale._id)).status).toBe('paid');

      // Even with the product back on the market, the consumed offer is rejected
      await Product.findByIdAndUpdate(productId, { status: 'active' });
      const res = await request(app)
        .post('/api/checkout/session')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ productId, offerId: offer._id.toString() })
        .expect(409);
      expect(res.body.code).toBe('OFFER_ALREADY_CONSUMED');
    });
  });
});
