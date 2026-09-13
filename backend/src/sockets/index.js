const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { toKey } = require('../utils/mongoId');

const setupSocket = (io) => {
  io.use(async (socket, next) => {
    try {
      // Token can come from: auth object (legacy), query param, or httpOnly cookie
      let token = socket.handshake.auth?.token || socket.handshake.query?.token;

      // Fallback: parse access_token from cookies
      if (!token && socket.handshake.headers?.cookie) {
        const cookies = socket.handshake.headers.cookie
          .split(';')
          .map((c) => c.trim().split('='))
          .reduce((acc, [key, ...val]) => {
            acc[key] = decodeURIComponent(val.join('='));
            return acc;
          }, {});
        token = cookies.access_token;
      }

      if (!token) return next(new Error('Authentication error'));
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.id);
      if (!user) return next(new Error('User not found'));
      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    socket.join(`user:${userId}`);
    console.log(`[Socket] User ${userId} connected`);

    await User.updateOne({ _id: userId }, { lastSeen: new Date() });
    io.emit('user:status', { userId, online: true });

    // Auto-join all conversation rooms for this user
    const conversations = await Conversation.find({ participants: userId }).lean();
    for (const conv of conversations) {
      socket.join(`conversation:${conv._id.toString()}`);
    }

    socket.on('conversation:join', (conversationId) => {
      socket.join(`conversation:${conversationId}`);
    });

    socket.on('conversation:leave', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // Chat message sending via socket
    socket.on('chat:send', async (payload) => {
      try {
        const { conversationId, text, attachments } = payload;
        if (!conversationId || (!text && (!attachments || attachments.length === 0))) return;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return;
        if (!conversation.participants.some((p) => p.toString() === userId)) return;

        const msgData = {
          conversation: conversationId,
          sender: userId,
          readBy: [{ user: userId, readAt: new Date() }],
        };
        if (text) msgData.content = text;
        if (attachments && attachments.length > 0) {
          msgData.attachments = attachments;
          msgData.type = 'image';
        }

        const message = await Message.create(msgData);

        const unread = conversation.unreadCounts || new Map();
        conversation.participants.forEach((pId) => {
          const key = toKey(pId);
          if (key !== userId) {
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

        // Emit to all participants (including sender for consistent UI)
        conversation.participants.forEach((pId) => {
          const key = pId.toString();
          io.to(`user:${key}`).emit('chat:message', populated);
          if (key !== userId) {
            io.to(`user:${key}`).emit('conversation:update', { conversationId });
          }
        });
      } catch (err) {
        console.error('[Socket] chat:send error:', err.message);
        socket.emit('chat:error', { message: 'Failed to send message' });
      }
    });

    // Typing indicators
    socket.on('typing:start', ({ conversationId, recipientId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing:start', { userId, conversationId });
      if (recipientId) socket.to(`user:${recipientId}`).emit('typing:start', { userId, conversationId });
    });

    socket.on('typing:stop', ({ conversationId, recipientId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing:stop', { userId, conversationId });
      if (recipientId) socket.to(`user:${recipientId}`).emit('typing:stop', { userId, conversationId });
    });

    // Mark messages as read via socket
    socket.on('chat:read', async ({ conversationId }) => {
      try {
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return;
        if (!conversation.participants.some((p) => p.toString() === userId)) return;

        const result = await Message.updateMany(
          {
            conversation: conversationId,
            sender: { $ne: userId },
            'readBy.user': { $ne: userId },
          },
          {
            $push: { readBy: { user: userId, readAt: new Date() } },
            $set: { status: 'read' },
          }
        );

        const unread = conversation.unreadCounts || new Map();
        unread.set(toKey(userId), 0);
        conversation.unreadCounts = unread;
        await conversation.save();

        // Notify other participants
        conversation.participants.forEach((pId) => {
          if (toKey(pId) !== userId) {
            io.to(`user:${pId.toString()}`).emit('conversation:read', {
              conversationId,
              readerId: userId,
              readCount: result.modifiedCount,
            });
          }
        });

        socket.emit('chat:read:ack', { conversationId, readCount: result.modifiedCount });
      } catch (err) {
        console.error('[Socket] chat:read error:', err.message);
      }
    });

    // ── WebRTC Voice Calling Signaling ──────────────────────────────────────

    socket.on('callUser', (data) => {
      const { userToCall, signalData, from, conversationId } = data;
      io.to(`user:${userToCall}`).emit('incomingCall', {
        signal: signalData,
        from,
        callerName: socket.user.name,
        conversationId,
      });
    });

    socket.on('answerCall', (data) => {
      const { to, signal } = data;
      io.to(`user:${to}`).emit('callAccepted', { signal });
    });

    socket.on('iceCandidate', (data) => {
      const { to, candidate } = data;
      io.to(`user:${to}`).emit('iceCandidate', { candidate });
    });

    socket.on('endCall', (data) => {
      const { to } = data;
      io.to(`user:${to}`).emit('callEnded');
    });

    socket.on('disconnect', async () => {
      console.log(`[Socket] User ${userId} disconnected`);
      try {
        await User.updateOne({ _id: userId }, { lastSeen: new Date() });
      } catch (_) {}
      io.emit('user:status', { userId, online: false, lastSeen: new Date() });
    });
  });

  return io;
};

module.exports = setupSocket;
