const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Sale = require('../models/Sale');
const Offer = require('../models/Offer');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const { createUser } = require('./helpers');

// Mock Stripe SDK (same shape as checkout.test.js)
jest.mock('stripe', () => {
  const mockStripe = {
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: 'cs_notif_mock',
          url: 'https://checkout.stripe.com/test',
          payment_intent: 'pi_notif_mock',
        }),
      },
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
    refunds: {
      create: jest.fn().mockResolvedValue({ id: 're_notif_mock' }),
    },
  };
  return jest.fn(() => mockStripe);
});

describe('Notification emitters', () => {
  let buyer, seller, third, admin;
  let productId, categoryId;

  beforeAll(async () => {
    buyer = await createUser({ role: 'buyer', email: 'notifbuyer@example.com' });
    seller = await createUser({ role: 'seller', email: 'notifseller@example.com' });
    third = await createUser({ role: 'buyer', email: 'notifthird@example.com' });
    admin = await createUser({ role: 'admin', email: 'notifadmin@example.com' });
  });

  beforeEach(async () => {
    const category = await Category.create({
      name: 'Notif Cat',
      slug: `notif-cat-${Date.now()}`,
      icon: 'box',
    });
    categoryId = category._id;

    const product = await Product.create({
      title: 'Notification Product',
      description: 'Product used for notification tests',
      price: 5000,
      category: categoryId,
      images: [{ url: 'http://x.com/n.jpg', publicId: 'n' }],
      seller: seller.user._id,
      status: 'active',
    });
    productId = product._id.toString();
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

  const countNotifs = (filter) => Notification.countDocuments(filter);

  const makeOffer = (token, amount = 4000) =>
    request(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, amount, message: 'Would you take this?' });

  const updateOfferStatus = (token, offerId, status) =>
    request(app)
      .put(`/api/offers/${offerId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status });

  const createPaidSale = (overrides = {}) =>
    Sale.create({
      product: productId,
      seller: seller.user._id,
      buyer: buyer.user._id,
      salePrice: 5000,
      platformFee: 250,
      netAmount: 4750,
      status: 'paid',
      paymentStatus: 'paid',
      stripePaymentIntentId: 'pi_notif_paid',
      history: [
        { status: 'pending_payment', actor: buyer.user._id, at: new Date() },
        { status: 'paid', actor: null, at: new Date() },
      ],
      ...overrides,
    });

  describe('Offer notifications', () => {
    it('notifies the seller when an offer is created', async () => {
      const { body } = await makeOffer(buyer.token).expect(201);

      expect(
        await countNotifs({ recipient: seller.user._id, type: 'offer', 'payload.offerId': body.offer._id })
      ).toBe(1);
      expect(await countNotifs({ recipient: buyer.user._id, type: 'offer' })).toBe(0);
    });

    it('notifies the buyer when the seller accepts via PUT', async () => {
      const { body } = await makeOffer(buyer.token).expect(201);
      await updateOfferStatus(seller.token, body.offer._id, 'accepted').expect(200);

      expect(
        await countNotifs({ recipient: buyer.user._id, type: 'offer', 'payload.offerId': body.offer._id })
      ).toBe(1);
    });

    it('notifies the buyer when the seller rejects via PUT', async () => {
      const { body } = await makeOffer(buyer.token).expect(201);
      await updateOfferStatus(seller.token, body.offer._id, 'rejected').expect(200);

      expect(
        await countNotifs({ recipient: buyer.user._id, type: 'offer', 'payload.offerId': body.offer._id })
      ).toBe(1);
    });

    it('notifies the seller when the buyer withdraws', async () => {
      const { body } = await makeOffer(buyer.token).expect(201);
      const filter = { recipient: seller.user._id, type: 'offer', 'payload.offerId': body.offer._id };
      const before = await countNotifs(filter);

      await updateOfferStatus(buyer.token, body.offer._id, 'withdrawn').expect(200);

      expect(await countNotifs(filter)).toBe(before + 1);
    });

    it('notifies the buyer with the new counter offer', async () => {
      const { body } = await makeOffer(buyer.token).expect(201);

      const res = await request(app)
        .post(`/api/offers/${body.offer._id}/counter`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ amount: 4500 })
        .expect(201);

      expect(
        await countNotifs({
          recipient: buyer.user._id,
          type: 'offer',
          'payload.offerId': res.body.offer._id,
        })
      ).toBe(1);
    });

    it('notifies the buyer via the dedicated accept endpoint', async () => {
      const { body } = await makeOffer(buyer.token).expect(201);
      await request(app)
        .post(`/api/offers/${body.offer._id}/accept`)
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(200);

      expect(
        await countNotifs({ recipient: buyer.user._id, type: 'offer', 'payload.offerId': body.offer._id })
      ).toBe(1);
    });

    it('creates no notification for an unauthorized offer update', async () => {
      const { body } = await makeOffer(buyer.token).expect(201);
      const filter = { 'payload.offerId': body.offer._id };
      const before = await countNotifs(filter); // just the creation notification

      await updateOfferStatus(third.token, body.offer._id, 'accepted').expect(403);

      expect(await countNotifs(filter)).toBe(before);
    });

    it('creates no notification for an invalid transition', async () => {
      const { body } = await makeOffer(buyer.token).expect(201);
      await updateOfferStatus(seller.token, body.offer._id, 'accepted').expect(200);
      await updateOfferStatus(seller.token, body.offer._id, 'rejected').expect(400);

      // Only the single valid transition notified the buyer
      expect(await countNotifs({ recipient: buyer.user._id, type: 'offer' })).toBe(1);
    });
  });

  describe('Order notifications', () => {
    it('notifies the seller when checkout is initiated', async () => {
      const res = await request(app)
        .post('/api/checkout/session')
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ productId })
        .expect(201);

      expect(
        await countNotifs({
          recipient: seller.user._id,
          type: 'order',
          'payload.saleId': res.body.saleId,
          'payload.productId': productId,
        })
      ).toBe(1);
    });

    it('notifies the buyer when the order ships', async () => {
      const sale = await createPaidSale();
      await request(app)
        .patch(`/api/orders/${sale._id}/ship`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ trackingNumber: 'TRK123' })
        .expect(200);

      expect(
        await countNotifs({ recipient: buyer.user._id, type: 'order', 'payload.saleId': sale._id })
      ).toBe(1);
    });

    it('notifies the seller when the buyer confirms delivery', async () => {
      const sale = await createPaidSale({
        status: 'shipped',
        trackingNumber: 'TRK1',
        history: [
          { status: 'pending_payment', actor: buyer.user._id, at: new Date() },
          { status: 'paid', actor: null, at: new Date() },
          { status: 'shipped', actor: seller.user._id, at: new Date() },
        ],
      });
      await request(app)
        .patch(`/api/orders/${sale._id}/deliver`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);

      expect(
        await countNotifs({ recipient: seller.user._id, type: 'order', 'payload.saleId': sale._id })
      ).toBe(1);
    });

    it('notifies the other participant when an order is cancelled', async () => {
      const sale = await createPaidSale({ status: 'pending_payment', paymentStatus: 'unpaid', stripePaymentIntentId: null });
      await request(app)
        .post(`/api/orders/${sale._id}/cancel`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);

      expect(
        await countNotifs({ recipient: seller.user._id, type: 'order', 'payload.saleId': sale._id })
      ).toBe(1);
    });

    it('notifies the seller when a paid order is cancelled with refund', async () => {
      const sale = await createPaidSale();
      await request(app)
        .post(`/api/orders/${sale._id}/cancel`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .expect(200);

      expect(
        await countNotifs({ recipient: seller.user._id, type: 'order', 'payload.saleId': sale._id })
      ).toBe(1);
    });

    it('creates no notification for unauthorized or invalid order actions', async () => {
      const sale = await createPaidSale({ status: 'pending_payment', paymentStatus: 'unpaid', stripePaymentIntentId: null });

      // Buyer cannot ship (403)
      await request(app)
        .patch(`/api/orders/${sale._id}/ship`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({})
        .expect(403);

      // Seller cannot ship a pending_payment order (400)
      await request(app)
        .patch(`/api/orders/${sale._id}/ship`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({})
        .expect(400);

      expect(await countNotifs({ 'payload.saleId': sale._id })).toBe(0);
    });
  });

  describe('Stripe webhook notifications', () => {
    const sendWebhook = () =>
      request(app)
        .post('/api/checkout/webhook')
        .set('stripe-signature', 'valid')
        .send({});

    beforeEach(() => {
      const stripe = require('stripe')();
      stripe.webhooks.constructEvent.mockReset();
    });

    it('notifies the seller when payment succeeds', async () => {
      const sale = await createPaidSale({
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        stripePaymentIntentId: null,
        stripeSessionId: 'cs_notif_paid',
      });

      const stripe = require('stripe')();
      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_notif_paid',
            payment_intent: 'pi_notif_paid',
            amount_total: 5000,
            metadata: { productId, sellerId: seller.user._id.toString() },
          },
        },
      });

      const res = await sendWebhook().expect(200);
      expect(res.body.result.processed).toBe(true);

      expect(
        await countNotifs({ recipient: seller.user._id, type: 'order', 'payload.saleId': sale._id })
      ).toBe(1);
    });

    it('notifies the buyer on an amount mismatch refund', async () => {
      const sale = await createPaidSale({
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        stripeSessionId: 'cs_notif_mismatch',
        salePrice: 4000,
        platformFee: 200,
        netAmount: 3800,
      });

      const stripe = require('stripe')();
      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_notif_mismatch',
            payment_intent: 'pi_notif_mismatch',
            amount_total: 5000,
            metadata: { productId },
          },
        },
      });

      const res = await sendWebhook().expect(200);
      expect(res.body.result.processed).toBe(false);
      expect(res.body.result.reason).toBe('amount_mismatch');

      expect(
        await countNotifs({ recipient: buyer.user._id, type: 'order', 'payload.saleId': sale._id })
      ).toBe(1);
    });

    it('notifies the buyer when a session expires', async () => {
      const sale = await createPaidSale({
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        stripeSessionId: 'cs_notif_expired',
      });

      const stripe = require('stripe')();
      stripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.expired',
        data: { object: { id: 'cs_notif_expired' } },
      });

      const res = await sendWebhook().expect(200);
      expect(res.body.result.processed).toBe(true);

      expect(
        await countNotifs({ recipient: buyer.user._id, type: 'order', 'payload.saleId': sale._id })
      ).toBe(1);
    });
  });

  describe('Report & admin moderation notifications', () => {
    it('notifies the reporter when their report is reviewed', async () => {
      const report = await Report.create({
        reporter: buyer.user._id,
        targetType: 'product',
        target: productId,
        reason: 'spam',
      });

      await request(app)
        .put(`/api/reports/${report._id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'resolved', action: 'Listing removed' })
        .expect(200);

      expect(
        await countNotifs({
          recipient: buyer.user._id,
          type: 'report_update',
          'payload.reportId': report._id,
          'payload.productId': productId,
        })
      ).toBe(1);
    });

    it('notifies the seller when their listing is moderated', async () => {
      await request(app)
        .put(`/api/admin/products/${productId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'rejected', flagReason: 'violates rules' })
        .expect(200);

      expect(
        await countNotifs({
          recipient: seller.user._id,
          type: 'admin_action',
          'payload.productId': productId,
        })
      ).toBe(1);
    });

    it('notifies the affected user on an admin account action', async () => {
      await request(app)
        .put(`/api/admin/users/${third.user._id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isVerified: true })
        .expect(200);

      expect(
        await countNotifs({ recipient: third.user._id, type: 'admin_action' })
      ).toBe(1);
    });

    it('creates no notification for a non-admin report update', async () => {
      const report = await Report.create({
        reporter: buyer.user._id,
        targetType: 'product',
        target: productId,
        reason: 'spam',
      });

      await request(app)
        .put(`/api/reports/${report._id}`)
        .set('Authorization', `Bearer ${third.token}`)
        .send({ status: 'resolved' })
        .expect(403);

      expect(await countNotifs({ type: 'report_update' })).toBe(0);
    });
  });

  describe('Chat notifications remain intact', () => {
    it('still notifies the recipient of a chat message', async () => {
      const conv = await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ recipientId: seller.user._id.toString(), productId })
        .expect(200);

      await request(app)
        .post('/api/chat/messages')
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ conversationId: conv.body.conversation._id, content: 'hello' })
        .expect(201);

      expect(
        await countNotifs({
          recipient: seller.user._id,
          type: 'message',
          'payload.conversationId': conv.body.conversation._id,
        })
      ).toBe(1);
    });
  });
});
