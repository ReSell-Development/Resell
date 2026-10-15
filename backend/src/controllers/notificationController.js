const { getNotifications, getUnreadCount, markRead, markAllRead } = require('../services/notificationService');

const getMyNotifications = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const data = await getNotifications(req.user._id, { page, limit });
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
};

const getUnread = async (req, res, next) => {
  try {
    const count = await getUnreadCount(req.user._id);
    res.json({ success: true, count });
  } catch (err) {
    next(err);
  }
};

const markAsRead = async (req, res, next) => {
  try {
    await markRead(req.params.id, req.user._id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const markAllAsRead = async (req, res, next) => {
  try {
    await markAllRead(req.user._id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

module.exports = { getMyNotifications, getUnread, markAsRead, markAllAsRead };
