const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');

const setupSocket = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
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

    // Mark user online
    await User.updateOne({ _id: userId }, { lastSeen: new Date() });
    io.emit('user:status', { userId, online: true });

    socket.on('conversation:join', (conversationId) => {
      socket.join(`conversation:${conversationId}`);
    });

    socket.on('conversation:leave', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on('typing:start', ({ conversationId, recipientId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing:start', { userId, conversationId });
      if (recipientId) socket.to(`user:${recipientId}`).emit('typing:start', { userId, conversationId });
    });

    socket.on('typing:stop', ({ conversationId, recipientId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing:stop', { userId, conversationId });
      if (recipientId) socket.to(`user:${recipientId}`).emit('typing:stop', { userId, conversationId });
    });

    socket.on('disconnect', async () => {
      console.log(`[Socket] User ${userId} disconnected`);
      await User.updateOne({ _id: userId }, { lastSeen: new Date() });
      io.emit('user:status', { userId, online: false, lastSeen: new Date() });
    });
  });

  return io;
};

module.exports = setupSocket;
