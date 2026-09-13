const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Review = require('../models/Review');
const { createUser } = require('./helpers');

describe('Seller Routes', () => {
  let sellerId, buyerToken;

  beforeAll(async () => {
    const seller = await createUser({ role: 'seller', email: 'sellerprofile@example.com' });
    sellerId = seller.user._id.toString();
    const buyer = await createUser({ role: 'buyer', email: 'sellerbuyer@example.com' });
    buyerToken = buyer.token;
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

  describe('POST /api/sellers/:id/reviews', () => {
    it('requires auth', async () => {
      await request(app)
        .post(`/api/sellers/${sellerId}/reviews`)
        .send({ rating: 5, comment: 'Great!' })
        .expect(401);
    });

    it('creates review with valid data', async () => {
      const res = await request(app)
        .post(`/api/sellers/${sellerId}/reviews`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ rating: 5, comment: 'Great seller!' })
        .expect(201);
      expect(res.body.success).toBe(true);
    });
  });
});
