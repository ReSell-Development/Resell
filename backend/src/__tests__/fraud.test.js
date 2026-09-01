const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');

describe('Fraud Detection', () => {
  let sellerToken;
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

  const setupFraudTest = async () => {
    const seller = await User.create({
      name: 'Fraud Seller',
      email: 'fraud@example.com',
      password: 'password123',
      role: 'seller',
    });

    const category = await Category.create({
      name: 'Fraud Category',
      slug: 'fraud-category',
      icon: 'package',
    });
    categoryId = category._id.toString();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'fraud@example.com', password: 'password123' });
    sellerToken = res.body.token;
  };

  beforeEach(async () => {
    await setupFraudTest();
  });

  beforeAll(async () => {
    const seller = await User.create({
      name: 'Fraud Seller',
      email: 'fraud@example.com',
      password: 'password123',
      role: 'seller',
    });

    const category = await Category.create({
      name: 'Fraud Category',
      slug: 'fraud-category',
      icon: 'package',
    });
    categoryId = category._id.toString();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'fraud@example.com', password: 'password123' });
    sellerToken = res.body.token;
  });

  afterAll(async () => {
    await server.close();
  });

  describe('Duplicate image detection', () => {
    it('should flag products with duplicate image hashes', async () => {
      // Create first product with a specific hash
      const product1 = await Product.create({
        title: 'Original Product',
        description: 'Original description',
        price: 100,
        category: categoryId,
        brand: 'TestBrand',
        condition: 'good',
        images: [{ url: 'https://example.com/img1.jpg', publicId: 'img1', hash: 'duplicate-hash-123' }],
        seller: (await User.findOne({ email: 'fraud@example.com' }))._id,
        aiAnalysis: { imageHashes: ['duplicate-hash-123'] },
      });

      // Create second product with same hash
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Duplicate Product',
          description: 'Duplicate description',
          price: 80,
          category: categoryId,
          brand: 'TestBrand',
          condition: 'good',
          images: [{ url: 'https://example.com/img2.jpg', publicId: 'img2', hash: 'duplicate-hash-123' }],
          specifications: [],
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.product.aiAnalysis.riskAssessment).toBeDefined();
      expect(res.body.product.aiAnalysis.riskAssessment.riskScore).toBeGreaterThanOrEqual(35);
      expect(res.body.product.aiAnalysis.riskAssessment.factors).toContainEqual(
        expect.stringContaining('Duplicate image detected')
      );
    });
  });

  describe('Suspicious pricing detection', () => {
    it('should flag suspiciously low price', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Very Cheap Product',
          description: 'Description',
          price: 10,
          originalPrice: 1000,
          category: categoryId,
          brand: 'TestBrand',
          condition: 'good',
          images: [{ url: 'https://example.com/img.jpg', publicId: 'img3', hash: 'hash-456' }],
          specifications: [],
        })
        .expect(201);

      expect(res.body.product.aiAnalysis.riskAssessment).toBeDefined();
      expect(res.body.product.aiAnalysis.riskAssessment.riskScore).toBeGreaterThanOrEqual(25);
      expect(res.body.product.aiAnalysis.riskAssessment.factors).toContainEqual(
        expect.stringContaining('suspiciously low')
      );
    });

    it('should flag high price above original', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Overpriced Product',
          description: 'Description',
          price: 2000,
          originalPrice: 1000,
          category: categoryId,
          brand: 'TestBrand',
          condition: 'good',
          images: [{ url: 'https://example.com/img.jpg', publicId: 'img4', hash: 'hash-789' }],
          specifications: [],
        })
        .expect(201);

      expect(res.body.product.aiAnalysis.riskAssessment).toBeDefined();
      expect(res.body.product.aiAnalysis.riskAssessment.factors).toContainEqual(
        expect.stringContaining('above original price')
      );
    });
  });

  describe('New account with high-value listing', () => {
    it('should flag new account with high value listing', async () => {
      const newUser = await User.create({
        name: 'New User',
        email: 'newuser@example.com',
        password: 'password123',
        role: 'seller',
      });

      const newTokenRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'newuser@example.com', password: 'password123' });

      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${newTokenRes.body.token}`)
        .send({
          title: 'Expensive Item',
          description: 'Description',
          price: 6000,
          originalPrice: 8000,
          category: categoryId,
          brand: 'TestBrand',
          condition: 'good',
          images: [{ url: 'https://example.com/img.jpg', publicId: 'img5', hash: 'hash-new' }],
          specifications: [],
        })
        .expect(201);

      expect(res.body.product.aiAnalysis.riskAssessment).toBeDefined();
      expect(res.body.product.aiAnalysis.riskAssessment.riskScore).toBeGreaterThanOrEqual(15);
      expect(res.body.product.aiAnalysis.riskAssessment.factors).toContainEqual(
        expect.stringContaining('High-value listing from new account')
      );
    });
  });
});