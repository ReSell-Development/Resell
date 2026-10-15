const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../server');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Conversation = require('../models/Conversation');
const { createUser } = require('./helpers');

describe('Unread Counts — string vs ObjectId key consistency', () => {
  let buyer, seller, product, buyerToken, sellerToken;

  beforeAll(async () => {
    buyer = await createUser({ name: 'Unread Buyer', role: 'buyer' });
    seller = await createUser({ name: 'Unread Seller', role: 'seller' });
    buyerToken = buyer.token;
    sellerToken = seller.token;

    const category = await Category.create({
      name: 'Unread Category',
      slug: 'unread-category',
      icon: 'package',
    });

    product = await Product.create({
      title: 'Unread Test Product',
      description: 'Testing unread counts',
      price: 100,
      category: category._id,
      images: [{ url: 'https://example.com/unread.jpg', publicId: 'unread123' }],
      seller: seller.user._id,
    });
  });

  it('unread count is accessible via both string and ObjectId form of the same user ID', async () => {
    // 1. Create a conversation
    const convRes = await request(app)
      .post('/api/chat/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ recipientId: seller.user._id.toString(), productId: product._id.toString() })
      .expect(200);

    expect(convRes.body.success).toBe(true);
    const conversationId = convRes.body.conversation._id;

    // 2. Send a message from buyer (seller should have unread count = 1)
    await request(app)
      .post('/api/chat/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ conversationId, content: 'Hello from buyer' })
      .expect(201);

    // 3. Verify unread count is readable with STRING key
    const convFromString = await Conversation.findById(conversationId);
    const sellerStringKey = seller.user._id.toString();
    expect(convFromString.unreadCounts.get(sellerStringKey)).toBe(1);

    // 4. Verify unread count is readable with OBJECTID key
    const convFromObjectId = await Conversation.findById(conversationId);
    const sellerObjectId = seller.user._id; // raw ObjectId, not .toString()
    expect(convFromObjectId.unreadCounts.get(sellerObjectId)).toBe(1);

    // 5. Both forms should return the same value
    expect(convFromString.unreadCounts.get(sellerStringKey)).toBe(
      convFromObjectId.unreadCounts.get(sellerObjectId)
    );

    // 6. Buyer's count should be 0 (sender resets own count)
    expect(convFromString.unreadCounts.get(buyer.user._id.toString())).toBe(0);

    // 7. After seller reads, both forms should return 0
    await request(app)
      .get(`/api/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const convAfterRead = await Conversation.findById(conversationId);
    expect(convAfterRead.unreadCounts.get(sellerStringKey)).toBe(0);
    expect(convAfterRead.unreadCounts.get(seller.user._id)).toBe(0);
  });

  it('unread counts survive a round-trip through MongoDB save', async () => {
    const convRes = await request(app)
      .post('/api/chat/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ recipientId: seller.user._id.toString() })
      .expect(200);

    const conversationId = convRes.body.conversation._id;

    // Send two messages
    await request(app)
      .post('/api/chat/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ conversationId, content: 'Message 1' })
      .expect(201);

    await request(app)
      .post('/api/chat/messages')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ conversationId, content: 'Message 2' })
      .expect(201);

    // Re-fetch from DB (simulates a fresh read)
    const conv = await Conversation.findById(conversationId);
    expect(conv.unreadCounts.get(seller.user._id.toString())).toBe(2);

    // Mark as read via the API
    await request(app)
      .post(`/api/chat/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    // Verify zero after save
    const convAfter = await Conversation.findById(conversationId);
    expect(convAfter.unreadCounts.get(seller.user._id.toString())).toBe(0);
    expect(convAfter.unreadCounts.get(seller.user._id)).toBe(0);
  });
});
