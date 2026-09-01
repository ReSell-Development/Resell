const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');

describe('Product Routes', () => {
  let userToken;
  let sellerToken;
  let adminToken;
  let categoryId;

  afterAll(async () => {
    await server.close();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  const setupUsers = async () => {
    const buyer = await User.create({
      name: 'Test Buyer',
      email: 'buyer@example.com',
      password: 'password123',
      role: 'buyer',
    });

    const seller = await User.create({
      name: 'Test Seller',
      email: 'seller@example.com',
      password: 'password123',
      role: 'seller',
    });

    const admin = await User.create({
      name: 'Test Admin',
      email: 'admin@example.com',
      password: 'password123',
      role: 'admin',
    });

    const category = await Category.create({
      name: 'Test Category',
      slug: 'test-category',
      icon: 'package',
    });
    categoryId = category._id.toString();

    const buyerRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'buyer@example.com', password: 'password123' });
    userToken = buyerRes.body.token;

    const sellerRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'seller@example.com', password: 'password123' });
    sellerToken = sellerRes.body.token;

    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password123' });
    adminToken = adminRes.body.token;
  };

  beforeEach(async () => {
    await setupUsers();
  });

  beforeAll(async () => {
    // Create test users
    const buyer = await User.create({
      name: 'Test Buyer',
      email: 'buyer@example.com',
      password: 'password123',
      role: 'buyer',
    });

    const seller = await User.create({
      name: 'Test Seller',
      email: 'seller@example.com',
      password: 'password123',
      role: 'seller',
    });

    const admin = await User.create({
      name: 'Test Admin',
      email: 'admin@example.com',
      password: 'password123',
      role: 'admin',
    });

    // Login to get tokens
    const buyerRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'buyer@example.com', password: 'password123' });
    userToken = buyerRes.body.token;

    const sellerRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'seller@example.com', password: 'password123' });
    sellerToken = sellerRes.body.token;

    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password123' });
    adminToken = adminRes.body.token;

    // Create a category
    const category = await Category.create({
      name: 'Test Category',
      slug: 'test-category',
      icon: 'package',
    });
    categoryId = category._id.toString();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /api/products', () => {
    it('should return paginated products', async () => {
      const res = await request(app)
        .get('/api/products')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items).toBeDefined();
      expect(res.body.pagination).toBeDefined();
    });

    it('should filter by category', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ category: categoryId })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should filter by price range', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ minPrice: 10, maxPrice: 100 })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should validate query parameters', async () => {
      const res = await request(app)
        .get('/api/products')
        .query({ page: -1 })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/products/:id', () => {
    let productId;

    beforeAll(async () => {
      const product = await Product.create({
        title: 'Test Product',
        description: 'Test description for product',
        price: 100,
        originalPrice: 150,
        category: categoryId,
        brand: 'TestBrand',
        condition: 'good',
        images: [{ url: 'https://example.com/image.jpg', publicId: 'test123' }],
        seller: await User.findOne({ email: 'seller@example.com' }).then(u => u._id),
      });
      productId = product._id.toString();
    });

    it('should return product by id', async () => {
      const res = await request(app)
        .get(`/api/products/${productId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.product.title).toBe('Test Product');
    });

    it('should return 404 for non-existent product', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/api/products/${fakeId}`)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/products (create)', () => {
    it('should create product as seller', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'New Product',
          description: 'A great product description',
          price: 200,
          originalPrice: 250,
          category: categoryId,
          brand: 'BrandX',
          condition: 'like-new',
          yearsUsed: 1,
          images: [{ url: 'https://example.com/img.jpg', publicId: 'img123', hash: 'abc123' }],
          specifications: [{ key: 'Color', value: 'Red' }],
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.product.title).toBe('New Product');
      expect(res.body.product.aiAnalysis).toBeDefined();
    });

    it('should reject creation without auth', async () => {
      const res = await request(app)
        .post('/api/products')
        .send({
          title: 'New Product',
          description: 'Description',
          price: 100,
          category: categoryId,
          images: [{ url: 'https://example.com/img.jpg', publicId: 'img123' }],
        })
        .expect(401);

      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('should reject creation as buyer', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          title: 'New Product',
          description: 'Description',
          price: 100,
          category: categoryId,
          images: [{ url: 'https://example.com/img.jpg', publicId: 'img123' }],
        })
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should validate required fields', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({})
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should validate price is positive', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Test',
          description: 'Description',
          price: -10,
          category: categoryId,
          images: [{ url: 'https://example.com/img.jpg', publicId: 'img123' }],
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/products/:id (update)', () => {
    let productId;

    beforeAll(async () => {
      const product = await Product.create({
        title: 'Product to Update',
        description: 'Original description',
        price: 150,
        category: categoryId,
        images: [{ url: 'https://example.com/img.jpg', publicId: 'img123' }],
        seller: await User.findOne({ email: 'seller@example.com' }).then(u => u._id),
      });
      productId = product._id.toString();
    });

    it('should update own product', async () => {
      const res = await request(app)
        .put(`/api/products/${productId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Updated Title',
          price: 180,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.product.title).toBe('Updated Title');
      expect(res.body.product.price).toBe(180);
    });

    it('should reject update by non-owner', async () => {
      const otherSeller = await User.create({
        name: 'Other Seller',
        email: 'other@example.com',
        password: 'password123',
        role: 'seller',
      });

      const otherTokenRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'other@example.com', password: 'password123' });

      const res = await request(app)
        .put(`/api/products/${productId}`)
        .set('Authorization', `Bearer ${otherTokenRes.body.token}`)
        .send({ title: 'Hacked Title' })
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow admin to update any product', async () => {
      const res = await request(app)
        .put(`/api/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Admin Updated' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.product.title).toBe('Admin Updated');
    });
  });

  describe('DELETE /api/products/:id', () => {
    let productId;

    beforeAll(async () => {
      const product = await Product.create({
        title: 'Product to Delete',
        description: 'Description',
        price: 100,
        category: categoryId,
        images: [{ url: 'https://example.com/img.jpg', publicId: 'img123' }],
        seller: await User.findOne({ email: 'seller@example.com' }).then(u => u._id),
      });
      productId = product._id.toString();
    });

    it('should delete own product', async () => {
      const res = await request(app)
        .delete(`/api/products/${productId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/products/:id/similar', () => {
    let productId;

    beforeAll(async () => {
      const product = await Product.create({
        title: 'Similar Product Test',
        description: 'Description',
        price: 100,
        category: categoryId,
        brand: 'SimilarBrand',
        condition: 'good',
        images: [{ url: 'https://example.com/img.jpg', publicId: 'img123' }],
        seller: await User.findOne({ email: 'seller@example.com' }).then(u => u._id),
      });
      productId = product._id.toString();
    });

    it('should return similar products', async () => {
      const res = await request(app)
        .get(`/api/products/${productId}/similar`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.items).toBeDefined();
    });
  });
});