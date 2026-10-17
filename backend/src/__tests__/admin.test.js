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

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

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

  describe('DELETE /api/admin/products/:id (force-delete)', () => {
    const AuditLog = require('../models/AuditLog');
    const Sale = require('../models/Sale');

    it('lets an admin force-delete any listing, even with an in-flight order', async () => {
      const seller = await createUser({ role: 'seller', email: `forceseller-${Date.now()}@example.com` });
      const buyer = await createUser({ role: 'buyer', email: `forcebuyer-${Date.now()}@example.com` });
      const category = await Category.create({
        name: 'Force Category',
        slug: `force-category-${Date.now()}`,
        icon: 'package',
      });
      const product = await Product.create({
        title: 'Force Delete Me',
        description: 'Admin removal target',
        price: 50,
        category: category._id,
        images: [{ url: 'https://example.com/force.jpg', publicId: 'force1' }],
        seller: seller.user._id,
        status: 'sold',
      });
      await Sale.create({
        product: product._id,
        seller: seller.user._id,
        buyer: buyer.user._id,
        salePrice: 50,
        netAmount: 47,
        status: 'paid',
      });

      await request(app)
        .delete(`/api/admin/products/${product._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'test moderation removal' })
        .expect(200);

      expect((await Product.findById(product._id)).status).toBe('removed');
      const audit = await AuditLog.findOne({ action: 'product_deleted', target: product._id });
      expect(audit).not.toBeNull();
      expect(audit.metadata.force).toBe(true);
      expect(audit.metadata.byRole).toBe('admin');
      expect(audit.metadata.reason).toBe('test moderation removal');
    });

    it('rejects non-admin (403) and unknown ids (404)', async () => {
      const seller = await createUser({ role: 'seller', email: `forceseller2-${Date.now()}@example.com` });
      const category = await Category.create({
        name: 'Force Category 2',
        slug: `force-category-2-${Date.now()}`,
        icon: 'package',
      });
      const product = await Product.create({
        title: 'Not Yours To Delete',
        description: 'Seller attempt at admin route',
        price: 50,
        category: category._id,
        images: [{ url: 'https://example.com/force2.jpg', publicId: 'force2' }],
        seller: seller.user._id,
      });

      await request(app)
        .delete(`/api/admin/products/${product._id}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(403);

      const mongoose = require('mongoose');
      await request(app)
        .delete(`/api/admin/products/${new mongoose.Types.ObjectId()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
