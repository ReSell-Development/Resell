const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const broadcastMessage = async (io, conversationId, message, excludeUserId) => {
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) return;

  const populated = await Message.findById(message._id).populate('sender', 'name avatar');

  conversation.participants.forEach((pId) => {
    const key = pId.toString();
    if (key !== excludeUserId) {
      io.to(`user:${key}`).emit('message:new', populated);
      io.to(`user:${key}`).emit('conversation:update', { conversationId });
    }
  });
};

const broadcastReadReceipt = async (io, conversationId, readerId) => {
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) return;

  conversation.participants.forEach((pId) => {
    if (pId.toString() !== readerId) {
      io.to(`user:${pId.toString()}`).emit('conversation:read', {
        conversationId,
        readerId,
      });
    }
  });
};

const broadcastTyping = (io, conversationId, userId, recipientId, event) => {
  io.to(`conversation:${conversationId}`).emit(event, { userId, conversationId });
  if (recipientId) {
    io.to(`user:${recipientId}`).emit(event, { userId, conversationId });
  }
};

module.exports = {
  broadcastMessage,
  broadcastReadReceipt,
  broadcastTyping,
};
