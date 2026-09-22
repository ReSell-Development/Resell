const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const User = require('../models/User');
const { toKey } = require('../utils/mongoId');
const { notify } = require('../services/notificationService');

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

    let isNew = false;
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.user._id, recipientId],
        product: productId || null,
        unreadCounts: { [toKey(req.user._id)]: 0, [toKey(recipientId)]: 0 },
      });
      isNew = true;
    }

    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'name avatar role')
      .populate('product', 'title images price status');

    if (isNew) {
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${recipientId}`).emit('conversation:update', {
          conversationId: conversation._id,
        });
      }
    }

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
    unread.set(toKey(req.user._id), 0);
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
    const { conversationId, content, attachments } = req.body;
    if (!conversationId || (!content && (!attachments || attachments.length === 0))) {
      throw new AppError('Conversation and content or attachments are required', 400, 'VALIDATION_ERROR');
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw new AppError('Conversation not found', 404, 'NOT_FOUND');

    if (!conversation.participants.some((p) => p.toString() === req.user._id.toString())) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    const msgData = {
      conversation: conversationId,
      sender: req.user._id,
      readBy: [{ user: req.user._id, readAt: new Date() }],
    };
    if (content) msgData.content = content;
    if (attachments && attachments.length > 0) {
      msgData.attachments = attachments;
      msgData.type = 'image';
    }

    const message = await Message.create(msgData);

    const unread = conversation.unreadCounts || new Map();
    conversation.participants.forEach((pId) => {
      const key = toKey(pId);
      if (key !== toKey(req.user._id)) {
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

    conversation.participants.forEach(async (pId) => {
      if (pId.toString() !== req.user._id.toString()) {
        await notify({
          recipient: pId,
          type: 'message',
          payload: { conversationId, senderId: req.user._id, productId: conversation.product },
        });
      }
    });

    const io = req.app.get('io');
    if (io) {
      conversation.participants.forEach((pId) => {
        const key = pId.toString();
        if (key !== req.user._id.toString()) {
          io.to(`user:${key}`).emit('message:new', populated);
          io.to(`user:${key}`).emit('conversation:update', { conversationId });
        }
      });
      // Send delivery confirmation to sender
      io.to(`user:${req.user._id.toString()}`).emit('chat:message:sent', {
        conversationId,
        messageId: message._id,
        status: 'delivered',
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

    const result = await Message.updateMany(
      {
        conversation: conversation._id,
        sender: { $ne: req.user._id },
        'readBy.user': { $ne: req.user._id },
      },
      {
        $push: { readBy: { user: req.user._id, readAt: new Date() } },
        $set: { status: 'read' },
      }
    );

    const unread = conversation.unreadCounts || new Map();
    unread.set(toKey(req.user._id), 0);
    conversation.unreadCounts = unread;
    await conversation.save();

    const io = req.app.get('io');
    if (io) {
      conversation.participants.forEach((pId) => {
        if (toKey(pId) !== toKey(req.user._id)) {
          io.to(`user:${pId.toString()}`).emit('conversation:read', {
            conversationId: conversation._id,
            readerId: req.user._id,
            readCount: result.modifiedCount,
          });
        }
      });
    }

    res.json({ success: true, readCount: result.modifiedCount });
  } catch (err) {
    next(err);
  }
};

const getUnreadCount = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const userKey = toKey(userId);
    const conversations = await Conversation.find({ participants: userId })
      .select('unreadCounts')
      .lean();
    let count = 0;
    const breakdown = {};
    for (const c of conversations) {
      let n = 0;
      if (c.unreadCounts instanceof Map) {
        n = c.unreadCounts.get(userKey) || 0;
      } else if (c.unreadCounts && typeof c.unreadCounts === 'object') {
        // Lean returns plain object when Map serialized
        n = c.unreadCounts[userKey] || c.unreadCounts.get?.(userKey) || 0;
      }
      if (n > 0) {
        breakdown[c._id] = n;
        count += n;
      }
    }
    res.json({ success: true, count, breakdown });
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
  getUnreadCount,
};
