const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Favorite = require('../models/Favorite');

const extractToken = (res) => {
  const setCookie = res.headers['set-cookie'] || [];
  const c = setCookie.find((s) => s.startsWith('access_token='));
  return c ? c.split(';')[0].split('=')[1] : null;
};

describe('Favorites Routes', () => {
  let userToken;
  let productId;

  afterAll(async () => {
    await server.close();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  const setupFavTest = async () => {
    const user = await User.create({
      name: 'Fav User',
      email: `fav-${Date.now()}@example.com`,
      password: 'password123',
      role: 'buyer',
    });

    const category = await Category.create({
      name: 'Fav Category',
      slug: `fav-category-${Date.now()}`,
      icon: 'package',
    });

    const product = await Product.create({
      title: 'Favorite Product',
      description: 'Description',
      price: 100,
      category: category._id,
      images: [{ url: 'https://example.com/img.jpg', publicId: 'img123' }],
      seller: user._id,
    });
    productId = product._id.toString();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'password123' });
    userToken = extractToken(res);
  };

  beforeEach(async () => {
    await setupFavTest();
  });

  describe('POST /api/favorites/:productId', () => {
    it('should add product to favorites', async () => {
      const res = await request(app)
        .post(`/api/favorites/${productId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should handle duplicate favorite gracefully', async () => {
      await request(app)
        .post(`/api/favorites/${productId}`)
        .set('Authorization', `Bearer ${userToken}`);

      const res = await request(app)
        .post(`/api/favorites/${productId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.favorited).toBe(true);
    });

    it('should require auth', async () => {
      const res = await request(app)
        .post(`/api/favorites/${productId}`)
        .expect(401);

      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('should validate product ID', async () => {
      const res = await request(app)
        .post('/api/favorites/invalid-id')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/favorites', () => {
    it('should return user favorites', async () => {
      const res = await request(app)
        .get('/api/favorites')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items).toBeDefined();
    });
  });

  describe('GET /api/favorites/:productId/check', () => {
    it('should return false when product is not favorited', async () => {
      const res = await request(app)
        .get(`/api/favorites/${productId}/check`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.favorited).toBe(false);
    });

    it('should return true when product is favorited', async () => {
      await request(app)
        .post(`/api/favorites/${productId}`)
        .set('Authorization', `Bearer ${userToken}`);

      const res = await request(app)
        .get(`/api/favorites/${productId}/check`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.favorited).toBe(true);
    });
  });

  describe('DELETE /api/favorites/:productId', () => {
    it('should remove product from favorites', async () => {
      await request(app)
        .post(`/api/favorites/${productId}`)
        .set('Authorization', `Bearer ${userToken}`);

      const res = await request(app)
        .delete(`/api/favorites/${productId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should return success for non-favorited product', async () => {
      const res = await request(app)
        .delete(`/api/favorites/${productId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });
});
