const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Report = require('../models/Report');
const { createUser } = require('./helpers');

describe('Admin Routes', () => {
  let adminToken, buyerToken, sellerId;

  beforeEach(async () => {
    const admin = await createUser({ role: 'admin', email: `admin-${Date.now()}@example.com` });
    adminToken = admin.token;
    const buyer = await createUser({ role: 'buyer', email: `buyer-${Date.now()}@example.com` });
    buyerToken = buyer.token;
  });

  afterAll(async () => { await server.close(); });

  describe('GET /api/admin/stats', () => {
    it('returns stats for admin', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats).toBeDefined();
    });

    it('rejects non-admin (403)', async () => {
      await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(403);
    });

    it('rejects unauthenticated (401)', async () => {
      await request(app)
        .get('/api/admin/stats')
        .expect(401);
    });
  });

  describe('GET /api/admin/users', () => {
    it('returns users list for admin', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe('PUT /api/admin/users/:id', () => {
    it('allows admin to update user role', async () => {
      const user = await createUser({ role: 'buyer', email: `updatetest-${Date.now()}@example.com` });
      const res = await request(app)
        .put(`/api/admin/users/${user.user._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'seller' })
        .expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/admin/products', () => {
    it('returns products list for admin', async () => {
      const res = await request(app)
        .get('/api/admin/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });
  });
});
