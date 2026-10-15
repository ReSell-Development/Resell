const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const Category = require('../models/Category');
const { createUser } = require('./helpers');

describe('Category Routes', () => {
  let adminToken, buyerToken;

  beforeAll(async () => {
    const admin = await createUser({ role: 'admin', email: 'cattestadmin@example.com' });
    adminToken = admin.token;
    const buyer = await createUser({ role: 'buyer', email: 'cattestbuyer@example.com' });
    buyerToken = buyer.token;
  });

  afterAll(async () => { await server.close(); });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      if (['users'].includes(key)) continue;
      await collections[key].deleteMany({});
    }
  });

  describe('GET /api/categories', () => {
    it('returns all categories', async () => {
      await Category.create({ name: 'Electronics', slug: 'electronics', icon: 'cpu' });
      const res = await request(app)
        .get('/api/categories')
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.categories.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /api/categories', () => {
    it('creates category as admin', async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Category', slug: 'new-cat', icon: 'box' })
        .expect(201);
      expect(res.body.success).toBe(true);
    });

    it('rejects creation by buyer (403)', async () => {
      await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ name: 'Should Fail', slug: 'should-fail', icon: 'x' })
        .expect(403);
    });

    it('validates required fields (400)', async () => {
      await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);
    });
  });

  describe('PUT /api/categories/:id', () => {
    it('updates category as admin', async () => {
      const cat = await Category.create({ name: 'Old', slug: 'old', icon: 'x' });
      const res = await request(app)
        .put(`/api/categories/${cat._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated' })
        .expect(200);
      expect(res.body.category.name).toBe('Updated');
    });
  });

  describe('DELETE /api/categories/:id', () => {
    it('deletes category as admin', async () => {
      const cat = await Category.create({ name: 'ToDelete', slug: 'to-delete', icon: 'x' });
      await request(app)
        .delete(`/api/categories/${cat._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });
});
