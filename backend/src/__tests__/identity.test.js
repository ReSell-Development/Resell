const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const ProductIdentity = require('../models/ProductIdentity');
const ProvenanceEvent = require('../models/ProvenanceEvent');
const { verifyProvenanceChain, hashIdentifier } = require('../services/provenance');

const extractToken = (res) => {
  const setCookie = res.headers['set-cookie'] || [];
  const c = setCookie.find((s) => s.startsWith('access_token='));
  return c ? c.split(';')[0].split('=')[1] : null;
};

const RAW_IMEI = '356938035643809';

const createUserAndLogin = async (name, role = 'seller') => {
  const user = await User.create({
    name,
    email: `${name.toLowerCase().replace(/\s/g, '')}-${Date.now()}${Math.random()
      .toString(36)
      .slice(2)}@example.com`,
    password: 'password123',
    role,
  });
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'password123' });
  return { user, token: extractToken(res) };
};

describe('Product Identity & Provenance', () => {
  let categoryId;
  let seller;
  let sellerToken;
  let otherSeller;
  let otherSellerToken;

  afterAll(async () => {
    await server.close();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  beforeEach(async () => {
    const category = await Category.create({
      name: `Phones ${Date.now()}`,
      slug: `phones-${Date.now()}`,
      icon: 'package',
    });
    categoryId = category._id.toString();

    ({ user: seller, token: sellerToken } = await createUserAndLogin('Owner Seller'));
    ({ user: otherSeller, token: otherSellerToken } = await createUserAndLogin('Other Seller'));
  });

  const createListing = (token, overrides = {}) =>
    request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'iPhone 14 Pro',
        description: 'Great condition phone',
        price: 800,
        category: categoryId,
        brand: 'Apple',
        condition: 'good',
        images: [{ url: 'https://example.com/img.jpg', publicId: 'img', hash: 'aabbccdd11223344' }],
        specifications: [],
        identifier: RAW_IMEI,
        identifierType: 'imei',
        ...overrides,
      });

  describe('New product registration', () => {
    it('creates a ProductIdentity and REGISTERED provenance event', async () => {
      const res = await createListing(sellerToken);
      expect(res.status).toBe(201);

      const identity = await ProductIdentity.findOne({ productId: res.body.product._id });
      expect(identity).toBeTruthy();
      expect(identity.identifierType).toBe('imei');
      expect(identity.status).toBe('active');
      expect(identity.currentOwnerId.toString()).toBe(seller._id.toString());

      const event = await ProvenanceEvent.findOne({ productIdentityId: identity._id });
      expect(event.eventType).toBe('registered');
      expect(event.previousHash).toBe('GENESIS');
      expect(event.hash).toBeTruthy();

      expect(res.body.identityStatus.status).toBe('active');
      expect(res.body.identityStatus.verification.verificationCode).toBeTruthy();
    });
  });

  describe('Hashed identifier only', () => {
    it('stores only SHA-256 hash, never the raw identifier', async () => {
      const res = await createListing(sellerToken).expect(201);

      const expectedHash = hashIdentifier(RAW_IMEI, 'imei');
      expect(expectedHash).toMatch(/^[a-f0-9]{64}$/);

      const identity = await ProductIdentity.findOne({ productId: res.body.product._id });
      expect(identity.identifierHash).toBe(expectedHash);
      expect(identity.identifierHash).not.toBe(RAW_IMEI);
      expect(identity.toObject()).not.toContain(RAW_IMEI);

      // Raw identifier must not appear anywhere in API responses
      expect(JSON.stringify(res.body)).not.toContain(RAW_IMEI);

      const identityRes = await request(app)
        .get(`/api/products/${res.body.product._id}/identity`)
        .expect(200);
      expect(JSON.stringify(identityRes.body)).not.toContain(RAW_IMEI);
      expect(identityRes.body.tracked).toBe(true);
    });

    it('enforces the unique (identifierType + identifierHash) index', async () => {
      await createListing(sellerToken).expect(201);
      await createListing(sellerToken, { title: 'Second listing' }).expect(201);

      const identities = await ProductIdentity.find({});
      expect(identities.length).toBe(1);
    });
  });

  describe('Legitimate relisting (same owner)', () => {
    it('does not create fraud signals for a sold-then-relisted product', async () => {
      const res1 = await createListing(sellerToken).expect(201);

      // Mark as sold, then relist
      await request(app)
        .patch(`/api/products/${res1.body.product._id}/sold`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      const res2 = await createListing(sellerToken, {
        title: 'Relisted iPhone 14 Pro',
        images: [{ url: 'https://example.com/img3.jpg', publicId: 'img3', hash: 'ffffffff00000001' }],
      }).expect(201);

      expect(res2.body.identityStatus.status).toBe('active');
      expect(res2.body.identityStatus.warnings).toHaveLength(0);
      expect(res2.body.product.aiAnalysis.riskAssessment.riskLevel).toBe('low');
    });

    it('flags simultaneous duplicate listings (multiple ACTIVE listings)', async () => {
      await createListing(sellerToken).expect(201);

      const res2 = await createListing(sellerToken, {
        title: 'Second live listing of the same phone',
        images: [{ url: 'https://example.com/img4.jpg', publicId: 'img4', hash: 'ffffffff00000002' }],
      }).expect(201);

      expect(res2.body.identityStatus.warnings.length).toBeGreaterThan(0);
      expect(res2.body.product.aiAnalysis.riskAssessment.factors).toContainEqual(
        expect.stringContaining('multiple active listings')
      );
    });
  });

  describe('Legitimate ownership transfer', () => {
    it('accepts resale when a completed Sale to the new seller exists', async () => {
      const res1 = await createListing(sellerToken).expect(201);
      const originalProductId = res1.body.product._id;

      // Verified platform sale: seller -> otherSeller
      await Sale.create({
        product: originalProductId,
        seller: seller._id,
        buyer: otherSeller._id,
        salePrice: 800,
        netAmount: 760,
        status: 'completed',
        paymentStatus: 'paid',
      });
      // The sold listing is taken down, as after a completed sale
      await request(app)
        .patch(`/api/products/${originalProductId}/sold`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      const res2 = await createListing(otherSellerToken, {
        images: [{ url: 'https://example.com/img5.jpg', publicId: 'img5', hash: 'ffffffff00000003' }],
      }).expect(201);

      expect(res2.body.identityStatus.status).toBe('active');
      expect(res2.body.identityStatus.warnings).toHaveLength(0);
      expect(res2.body.product.aiAnalysis.riskAssessment.factors).not.toContainEqual(
        expect.stringContaining('different owner')
      );

      const identity = await ProductIdentity.findOne({ productId: originalProductId });
      expect(identity.currentOwnerId.toString()).toBe(otherSeller._id.toString());

      const transferEvents = await ProvenanceEvent.find({ eventType: 'ownership_transferred' });
      expect(transferEvents.length).toBe(1);
      expect(transferEvents[0].ownerId.toString()).toBe(otherSeller._id.toString());
    });
  });

  describe('Ownership mismatch', () => {
    it('emits OWNERSHIP_MISMATCH + NO_VERIFIED_TRANSFER when no transfer exists', async () => {
      const res1 = await createListing(sellerToken).expect(201);

      // Mark sold so the multiple-active-listings signal doesn't mask the test
      await request(app)
        .patch(`/api/products/${res1.body.product._id}/sold`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      const res2 = await createListing(otherSellerToken, {
        images: [{ url: 'https://example.com/img6.jpg', publicId: 'img6', hash: 'ffffffff00000004' }],
      }).expect(403);

      expect(res2.body.code).toBe('OWNERSHIP_MISMATCH');
    });
  });

  describe('Stolen / flagged products', () => {
    it('blocks listing when identifier is reported_stolen', async () => {
      const res1 = await createListing(sellerToken).expect(201);
      const identity = await ProductIdentity.findOne({ productId: res1.body.product._id });
      identity.status = 'reported_stolen';
      await identity.save();

      const res2 = await createListing(otherSellerToken, {
        images: [{ url: 'https://example.com/img7.jpg', publicId: 'img7', hash: 'ffffffff00000005' }],
      }).expect(403);

      expect(res2.body.code).toBe('IDENTITY_BLOCKED');
    });

    it('holds product for moderation when identity is flagged', async () => {
      const res1 = await createListing(sellerToken).expect(201);
      const identity = await ProductIdentity.findOne({ productId: res1.body.product._id });
      identity.status = 'flagged';
      await identity.save();

      const res2 = await createListing(sellerToken, {
        title: 'Relist of flagged identity',
        images: [{ url: 'https://example.com/img8.jpg', publicId: 'img8', hash: 'ffffffff00000006' }],
      }).expect(201);

      expect(res2.body.product.status).toBe('flagged');
      expect(res2.body.product.isFlagged).toBe(true);
      expect(res2.body.product.aiAnalysis.riskAssessment.riskLevel).toBe('high');
    });
  });

  describe('Provenance chain', () => {
    it('detects tampering', async () => {
      const res1 = await createListing(sellerToken).expect(201);
      const identity = await ProductIdentity.findOne({ productId: res1.body.product._id });

      expect((await verifyProvenanceChain(identity._id)).valid).toBe(true);

      // Tamper with an event in the database
      const event = await ProvenanceEvent.findOne({ productIdentityId: identity._id });
      event.ownerId = otherSeller._id;
      await event.save();

      const verification = await verifyProvenanceChain(identity._id);
      expect(verification.valid).toBe(false);
      expect(verification.brokenAt).toBe(event._id.toString());

      // Status endpoint surfaces the integrity failure — without owner PII
      const identityRes = await request(app)
        .get(`/api/products/${res1.body.product._id}/identity`)
        .expect(200);
      expect(identityRes.body.provenance.valid).toBe(false);
      expect(identityRes.body.warnings.length).toBeGreaterThan(0);
      expect(JSON.stringify(identityRes.body)).not.toContain(otherSeller._id.toString());
    });
  });

  describe('Integration with existing fraud engine', () => {
    it('existing pHash duplicate detection still works (risk >= 35)', async () => {
      // Original listing with a known perceptual hash (same setup as fraud.test.js)
      await Product.create({
        title: 'Original Product',
        description: 'Original description',
        price: 100,
        category: categoryId,
        brand: 'TestBrand',
        condition: 'good',
        images: [{ url: 'https://example.com/img1.jpg', publicId: 'img1' }],
        seller: seller._id,
        aiAnalysis: { imageHashes: ['aabbccdd11223344'] },
      });

      const res = await createListing(sellerToken, {
        title: 'Duplicate Product',
        description: 'Duplicate description',
        price: 80,
        identifier: '',
        images: [{ url: 'https://example.com/img2.jpg', publicId: 'img2', hash: 'aabbccdd11223344' }],
      }).expect(201);

      expect(res.body.product.aiAnalysis.riskAssessment.riskScore).toBeGreaterThanOrEqual(35);
      expect(res.body.product.aiAnalysis.riskAssessment.factors).toContainEqual(
        expect.stringContaining('Duplicate image detected')
      );
    });

    it('image duplicate + valid ownership transfer does NOT automatically become fraud', async () => {
      const res1 = await createListing(sellerToken).expect(201);

      await Sale.create({
        product: res1.body.product._id,
        seller: seller._id,
        buyer: otherSeller._id,
        salePrice: 800,
        netAmount: 760,
        status: 'completed',
        paymentStatus: 'paid',
      });
      await request(app)
        .patch(`/api/products/${res1.body.product._id}/sold`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      const res2 = await createListing(otherSellerToken, {
        // Same image hash as original listing (reused image), but transfer verified
        images: [{ url: 'https://example.com/img9.jpg', publicId: 'img9', hash: 'aabbccdd11223344' }],
      }).expect(201);

      const assessment = res2.body.product.aiAnalysis.riskAssessment;
      // Image reuse is still detected (supporting signal)...
      expect(assessment.factors).toContainEqual(
        expect.stringContaining('Duplicate image detected')
      );
      // ...but the verified transfer means this is NOT automatically flagged as fraud
      expect(assessment.factors).not.toContainEqual(
        expect.stringContaining('different owner')
      );
      expect(assessment.factors).not.toContainEqual(
        expect.stringContaining('No verified ownership transfer')
      );
      expect(assessment.riskLevel).not.toBe('high');
    });

    it('image duplicate + ownership mismatch increases risk', async () => {
      const res1 = await createListing(sellerToken).expect(201);

      await request(app)
        .patch(`/api/products/${res1.body.product._id}/sold`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      const res2 = await createListing(otherSellerToken, {
        images: [{ url: 'https://example.com/img10.jpg', publicId: 'img10', hash: 'aabbccdd11223344' }],
      }).expect(403);

      // Blocked outright — mismatch with reused image is the highest-risk case
      expect(res2.body.code).toBe('OWNERSHIP_MISMATCH');
    });
  });
});
