const express = require('express');
const router = express.Router();
const {
  getOrCreateConversation,
  getConversations,
  getMessages,
  sendMessage,
  markRead,
} = require('../controllers/chatController');
const { protect } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rateLimiters');
const {
  createConversationValidation,
  sendMessageValidation,
  getMessagesValidation,
} = require('../middleware/validate');

router.use(protect);

router.post('/conversations', createConversationValidation, getOrCreateConversation);
router.get('/conversations', getConversations);
router.get('/conversations/:id/messages', getMessagesValidation, getMessages);
router.post('/messages', chatLimiter, sendMessageValidation, sendMessage);
router.post('/conversations/:id/read', markRead);

module.exports = router;
