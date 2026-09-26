const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { toKey } = require('../utils/mongoId');

// Server-side online users tracking: userId -> Set of socketIds (handles multiple tabs)
const onlineUsers = new Map();
const activeCalls = new Map();

const isParticipant = (conversation, userId) =>
  conversation.participants.some((participant) => toKey(participant) === String(userId));

const publishCallMessage = (io, conversation, message, event = 'chat:message') => {
  conversation.participants.forEach((participant) => {
    io.to(`user:${participant.toString()}`).emit(event, message);
    io.to(`user:${participant.toString()}`).emit('conversation:update', { conversationId: conversation._id });
  });
};

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

    // Track this socket for the user
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    // If this is the first socket for this user, broadcast online status
    if (onlineUsers.get(userId).size === 1) {
      console.log(`[Socket] User ${userId} came online`);
      await User.updateOne({ _id: userId }, { lastSeen: new Date() });
      io.emit('user:status', { userId, online: true });
    }

    // Send current online users list to the newly connected socket
    const onlineUserIds = Array.from(onlineUsers.keys());
    socket.emit('user:online-list', { onlineUsers: onlineUserIds });

    socket.join(`user:${userId}`);
    console.log(`[Socket] User ${userId} connected (socket: ${socket.id})`);

    // Auto-join all conversation rooms for this user
    const conversations = await Conversation.find({ participants: userId }).lean();
    for (const conv of conversations) {
      socket.join(`conversation:${conv._id.toString()}`);
    }

    socket.on('conversation:join', async (conversationId) => {
      if (!conversationId) return;
      const conversation = await Conversation.findOne({ _id: conversationId, participants: userId }).lean().catch(() => null);
      if (conversation) socket.join(`conversation:${conversationId}`);
    });

    socket.on('conversation:leave', async (conversationId) => {
      if (!conversationId) return;
      const conversation = await Conversation.findOne({ _id: conversationId, participants: userId }).lean().catch(() => null);
      if (conversation) socket.leave(`conversation:${conversationId}`);
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

    socket.on('callUser', async (data = {}) => {
      try {
        const { userToCall, signalData, conversationId, callId } = data;
        if (!userToCall || !conversationId || !callId || typeof callId !== 'string' || callId.length > 100) return;
        const conversation = await Conversation.findById(conversationId);
        if (!conversation || !isParticipant(conversation, userId) || !isParticipant(conversation, userToCall) || String(userToCall) === userId) return;
        if (activeCalls.has(callId)) return;

        const callMessage = await Message.create({
          conversation: conversation._id,
          sender: userId,
          type: 'call',
          readBy: [{ user: userId, readAt: new Date() }],
          call: { callId, outcome: 'outgoing', startedAt: new Date() },
        });
        conversation.lastMessage = callMessage._id;
        conversation.lastMessageAt = callMessage.createdAt;
        await conversation.save();
        const populated = await Message.findById(callMessage._id).populate('sender', 'name avatar');
        activeCalls.set(callId, { callerId: userId, calleeId: String(userToCall), conversationId: String(conversation._id), messageId: String(callMessage._id), acceptedAt: null });
        publishCallMessage(io, conversation, populated);
        io.to(`user:${userToCall}`).emit('incomingCall', { signal: signalData, from: userId, callerName: socket.user.name, conversationId, callId });
      } catch (err) {
        socket.emit('call:error', { message: 'Unable to start call' });
      }
    });

    socket.on('answerCall', (data = {}) => {
      const { to, signal, callId } = data;
      const call = activeCalls.get(callId);
      if (!call || call.calleeId !== userId || call.callerId !== String(to)) return;
      call.acceptedAt = new Date();
      io.to(`user:${call.callerId}`).emit('callAccepted', { signal, callId });
    });

    socket.on('iceCandidate', (data = {}) => {
      const { to, candidate, callId } = data;
      const call = activeCalls.get(callId);
      if (!call || ![call.callerId, call.calleeId].includes(userId) || ![call.callerId, call.calleeId].includes(String(to)) || String(to) === userId) return;
      io.to(`user:${to}`).emit('iceCandidate', { candidate, callId });
    });

    socket.on('endCall', async (data = {}) => {
      const { to, callId, reason } = data;
      const call = activeCalls.get(callId);
      if (!call || ![call.callerId, call.calleeId].includes(userId) || ![call.callerId, call.calleeId].includes(String(to)) || String(to) === userId) return;
      activeCalls.delete(callId);
      const endedAt = new Date();
      const durationSeconds = call.acceptedAt ? Math.max(0, Math.round((endedAt - call.acceptedAt) / 1000)) : 0;
      const outcome = call.acceptedAt ? 'completed' : (reason === 'rejected' ? 'rejected' : reason === 'missed' ? 'missed' : 'cancelled');
      const message = await Message.findByIdAndUpdate(call.messageId, { $set: { 'call.outcome': outcome, 'call.durationSeconds': durationSeconds, 'call.endedAt': endedAt } }, { new: true }).populate('sender', 'name avatar');
      const conversation = await Conversation.findById(call.conversationId);
      if (message && conversation) publishCallMessage(io, conversation, message, 'call:updated');
      io.to(`user:${to}`).emit('callEnded', { callId });
    });

    socket.on('disconnect', async () => {
      console.log(`[Socket] User ${userId} disconnected (socket: ${socket.id})`);

      // Remove this socket from the user's socket set
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        // If no more sockets for this user, mark as offline
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          console.log(`[Socket] User ${userId} went offline`);
          try {
            await User.updateOne({ _id: userId }, { lastSeen: new Date() });
          } catch (_) {}
          // A caller/callee may close the tab without pressing an action. Finalize
          // any pending history entry once their last socket has disconnected.
          for (const [callId, call] of activeCalls.entries()) {
            if (call.callerId !== userId && call.calleeId !== userId) continue;
            activeCalls.delete(callId);
            const endedAt = new Date();
            const durationSeconds = call.acceptedAt ? Math.max(0, Math.round((endedAt - call.acceptedAt) / 1000)) : 0;
            const outcome = call.acceptedAt ? 'completed' : (call.calleeId === userId ? 'missed' : 'cancelled');
            const message = await Message.findByIdAndUpdate(call.messageId, {
              $set: { 'call.outcome': outcome, 'call.durationSeconds': durationSeconds, 'call.endedAt': endedAt },
            }, { new: true }).populate('sender', 'name avatar');
            const conversation = await Conversation.findById(call.conversationId);
            if (message && conversation) publishCallMessage(io, conversation, message, 'call:updated');
            const otherUserId = call.callerId === userId ? call.calleeId : call.callerId;
            io.to(`user:${otherUserId}`).emit('callEnded', { callId });
          }
          io.emit('user:status', { userId, online: false, lastSeen: new Date() });
        }
      }
    });
  });

  return io;
};

module.exports = setupSocket;
