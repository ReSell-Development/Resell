const Notification = require('../models/Notification');

const notify = async ({ recipient, type, payload = {} }) => {
  try {
    return await Notification.create({ recipient, type, payload });
  } catch (err) {
    console.error(`[Notification] Failed to create: ${err.message}`);
    return null;
  }
};

const getUnreadCount = async (recipientId) => {
  return Notification.countDocuments({ recipient: recipientId, read: false });
};

const getNotifications = async (recipientId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Notification.find({ recipient: recipientId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('payload.senderId', 'name avatar')
      .populate('payload.offerId', 'amount status product')
      .populate('payload.productId', 'title images'),
    Notification.countDocuments({ recipient: recipientId }),
  ]);
  return {
    notifications: items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

const markRead = async (notificationId, recipientId) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, recipient: recipientId },
    { read: true },
    { new: true }
  );
};

const markAllRead = async (recipientId) => {
  return Notification.updateMany(
    { recipient: recipientId, read: false },
    { read: true }
  );
};

module.exports = { notify, getUnreadCount, getNotifications, markRead, markAllRead };
