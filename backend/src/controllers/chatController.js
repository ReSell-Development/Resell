const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const User = require('../models/User');

const getOrCreateConversation = async (req, res, next) => {
  try {
    const { recipientId, productId } = req.body;
    if (!recipientId) throw new AppError('Recipient is required', 400, 'VALIDATION_ERROR');

    if (recipientId === req.user._id.toString()) {
      throw new AppError('Cannot start conversation with yourself', 400, 'INVALID_RECIPIENT');
    }

    const recipient = await User.findById(recipientId);
    if (!recipient) throw new AppError('Recipient not found', 404, 'NOT_FOUND');

    let conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, recipientId] },
      product: productId || null,
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.user._id, recipientId],
        product: productId || null,
        unreadCounts: { [req.user._id.toString()]: 0, [recipientId]: 0 },
      });
    }

    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'name avatar role')
      .populate('product', 'title images price status');

    res.json({ success: true, conversation: populated });
  } catch (err) {
    next(err);
  }
};

const getConversations = async (req, res, next) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user._id,
    })
      .populate('participants', 'name avatar role')
      .populate('product', 'title images price status')
      .populate({
        path: 'lastMessage',
        select: 'content sender createdAt',
      })
      .sort({ lastMessageAt: -1 });

    res.json({ success: true, conversations });
  } catch (err) {
    next(err);
  }
};

const getMessages = async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) throw new AppError('Conversation not found', 404, 'NOT_FOUND');

    if (!conversation.participants.some((p) => p.toString() === req.user._id.toString())) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      Message.find({ conversation: conversation._id })
        .populate('sender', 'name avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Message.countDocuments({ conversation: conversation._id }),
    ]);

    // Mark as read
    await Message.updateMany(
      {
        conversation: conversation._id,
        sender: { $ne: req.user._id },
        'readBy.user': { $ne: req.user._id },
      },
      { $push: { readBy: { user: req.user._id, readAt: new Date() } } }
    );

    // Reset unread count
    const unread = conversation.unreadCounts || new Map();
    unread.set(req.user._id.toString(), 0);
    conversation.unreadCounts = unread;
    await conversation.save();

    res.json({
      success: true,
      messages: messages.reverse(),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const { conversationId, content } = req.body;
    if (!conversationId || !content) {
      throw new AppError('Conversation and content are required', 400, 'VALIDATION_ERROR');
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw new AppError('Conversation not found', 404, 'NOT_FOUND');

    if (!conversation.participants.some((p) => p.toString() === req.user._id.toString())) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    const message = await Message.create({
      conversation: conversationId,
      sender: req.user._id,
      content,
      readBy: [{ user: req.user._id, readAt: new Date() }],
    });

    // Update conversation
    const unread = conversation.unreadCounts || new Map();
    conversation.participants.forEach((pId) => {
      const key = pId.toString();
      if (key !== req.user._id.toString()) {
        unread.set(key, (unread.get(key) || 0) + 1);
      } else {
        unread.set(key, 0);
      }
    });
    conversation.unreadCounts = unread;
    conversation.lastMessage = message._id;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    const populated = await Message.findById(message._id).populate('sender', 'name avatar');

    // Emit to socket if available
    const io = req.app.get('io');
    if (io) {
      // Send message:new to all participants except sender (to avoid duplicate with optimistic UI)
      conversation.participants.forEach((pId) => {
        const key = pId.toString();
        if (key !== req.user._id.toString()) {
          io.to(`user:${key}`).emit('message:new', populated);
        }
      });
      // Also notify each participant for conversation list update
      conversation.participants.forEach((pId) => {
        const key = pId.toString();
        if (key !== req.user._id.toString()) {
          io.to(`user:${key}`).emit('conversation:update', { conversationId });
        }
      });
    }

    res.status(201).json({ success: true, message: populated });
  } catch (err) {
    next(err);
  }
};

const markRead = async (req, res, next) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
    if (!conversation.participants.some((p) => p.toString() === req.user._id.toString())) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    await Message.updateMany(
      {
        conversation: conversation._id,
        sender: { $ne: req.user._id },
        'readBy.user': { $ne: req.user._id },
      },
      { $push: { readBy: { user: req.user._id, readAt: new Date() } } }
    );

    const unread = conversation.unreadCounts || new Map();
    unread.set(req.user._id.toString(), 0);
    conversation.unreadCounts = unread;
    await conversation.save();

    const io = req.app.get('io');
    if (io) {
      conversation.participants.forEach((pId) => {
        if (pId.toString() !== req.user._id.toString()) {
          io.to(`user:${pId.toString()}`).emit('conversation:read', {
            conversationId: conversation._id,
            readerId: req.user._id,
          });
        }
      });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getOrCreateConversation,
  getConversations,
  getMessages,
  sendMessage,
  markRead,
};
