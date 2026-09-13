const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const extractToken = (res) => {
  const setCookie = res.headers['set-cookie'] || [];
  const c = setCookie.find((s) => s.startsWith('access_token='));
  return c ? c.split(';')[0].split('=')[1] : null;
};

describe('Chat Routes', () => {
  let sellerToken, buyerToken, sellerId, buyerId, productId, conversationId;

  beforeAll(async () => {
    const seller = await User.create({
      name: 'Chat Seller',
      email: 'chatseller@example.com',
      password: 'password123',
      role: 'seller',
    });
    sellerId = seller._id.toString();

    const buyer = await User.create({
      name: 'Chat Buyer',
      email: 'chatbuyer@example.com',
      password: 'password123',
      role: 'buyer',
    });
    buyerId = buyer._id.toString();

    const category = await Category.create({
      name: 'Chat Category',
      slug: 'chat-category',
      icon: 'package',
    });

    const product = await Product.create({
      title: 'Chat Test Product',
      description: 'A product for chat testing',
      price: 200,
      category: category._id,
      images: [{ url: 'https://example.com/chat.jpg', publicId: 'chat123' }],
      seller: sellerId,
    });
    productId = product._id.toString();

    const sellerRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'chatseller@example.com', password: 'password123' });
    sellerToken = extractToken(sellerRes);

    const buyerRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'chatbuyer@example.com', password: 'password123' });
    buyerToken = extractToken(buyerRes);
  });

  afterAll(async () => {
    await server.close();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      if (['users', 'categories', 'products'].includes(key)) continue;
      await collections[key].deleteMany({});
    }
  });

  describe('POST /api/chat/conversations', () => {
    it('should create a new conversation', async () => {
      const res = await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ recipientId: sellerId, productId })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.conversation).toBeDefined();
      expect(res.body.conversation.participants).toHaveLength(2);
      conversationId = res.body.conversation._id;
    });

    it('should return existing conversation on duplicate', async () => {
      await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ recipientId: sellerId, productId });

      const res = await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ recipientId: sellerId, productId })
        .expect(200);

      expect(res.body.success).toBe(true);
      conversationId = res.body.conversation._id;
    });

    it('should reject self-conversation', async () => {
      const res = await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ recipientId: buyerId, productId })
        .expect(400);

      expect(res.body.code).toBe('INVALID_RECIPIENT');
    });

    it('should require auth', async () => {
      await request(app)
        .post('/api/chat/conversations')
        .send({ recipientId: sellerId, productId })
        .expect(401);
    });

    it('should validate recipient ID', async () => {
      await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ recipientId: 'invalid-id', productId })
        .expect(400);
    });
  });

  describe('GET /api/chat/conversations', () => {
    it('should list conversations for logged-in user', async () => {
      await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ recipientId: sellerId, productId });

      const res = await request(app)
        .get('/api/chat/conversations')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.conversations)).toBe(true);
      expect(res.body.conversations.length).toBeGreaterThanOrEqual(1);
    });

    it('should require auth', async () => {
      await request(app)
        .get('/api/chat/conversations')
        .expect(401);
    });
  });

  describe('POST /api/chat/messages', () => {
    beforeEach(async () => {
      const conv = await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ recipientId: sellerId, productId });
      conversationId = conv.body.conversation._id;
    });

    it('should send a message', async () => {
      const res = await request(app)
        .post('/api/chat/messages')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ conversationId, content: 'Hello seller!' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.message.content).toBe('Hello seller!');
      expect(res.body.message.sender._id).toBe(buyerId);
    });

    it('should reject message from non-participant', async () => {
      const outsider = await User.create({
        name: 'Outsider',
        email: 'outsider@example.com',
        password: 'password123',
        role: 'buyer',
      });
      const outsiderRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'outsider@example.com', password: 'password123' });

      await request(app)
        .post('/api/chat/messages')
        .set('Authorization', `Bearer ${extractToken(outsiderRes)}`)
        .send({ conversationId, content: 'I should not see this' })
        .expect(403);
    });

    it('should require conversation and content', async () => {
      await request(app)
        .post('/api/chat/messages')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({})
        .expect(400);
    });
  });

  describe('GET /api/chat/conversations/:id/messages', () => {
    beforeEach(async () => {
      const conv = await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ recipientId: sellerId, productId });
      conversationId = conv.body.conversation._id;

      await request(app)
        .post('/api/chat/messages')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ conversationId, content: 'Message 1' });
      await request(app)
        .post('/api/chat/messages')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ conversationId, content: 'Message 2' });
    });

    it('should return paginated messages', async () => {
      const res = await request(app)
        .get(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBe(2);
    });

    it('should mark messages as read', async () => {
      await request(app)
        .get(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      const conv = await Conversation.findById(conversationId);
      expect(conv.unreadCounts.get(sellerId)).toBe(0);
    });

    it('should reject non-participant access', async () => {
      const outsider = await User.create({
        name: 'Outsider 2',
        email: 'outsider2@example.com',
        password: 'password123',
        role: 'buyer',
      });
      const outsiderRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'outsider2@example.com', password: 'password123' });

      await request(app)
        .get(`/api/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${extractToken(outsiderRes)}`)
        .expect(403);
    });

    it('should return 404 for non-existent conversation', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      await request(app)
        .get(`/api/chat/conversations/${fakeId}/messages`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(404);
    });
  });

  describe('POST /api/chat/conversations/:id/read', () => {
    beforeEach(async () => {
      const conv = await request(app)
        .post('/api/chat/conversations')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ recipientId: sellerId, productId });
      conversationId = conv.body.conversation._id;

      await request(app)
        .post('/api/chat/messages')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ conversationId, content: 'Unread message' });
    });

    it('should mark conversation as read', async () => {
      const res = await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.readCount).toBeGreaterThanOrEqual(1);

      const conv = await Conversation.findById(conversationId);
      expect(conv.unreadCounts.get(sellerId)).toBe(0);
    });

    it('should reject non-participant', async () => {
      const outsider = await User.create({
        name: 'Outsider 3',
        email: 'outsider3@example.com',
        password: 'password123',
        role: 'buyer',
      });
      const outsiderRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'outsider3@example.com', password: 'password123' });

      await request(app)
        .post(`/api/chat/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${extractToken(outsiderRes)}`)
        .expect(403);
    });
  });
});
