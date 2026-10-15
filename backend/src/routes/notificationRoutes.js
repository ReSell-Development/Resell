const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getMyNotifications, getUnread, markAsRead, markAllAsRead } = require('../controllers/notificationController');

router.use(protect);

router.get('/', getMyNotifications);
router.get('/unread', getUnread);
router.patch('/:id/read', markAsRead);
router.patch('/read-all', markAllAsRead);

module.exports = router;
