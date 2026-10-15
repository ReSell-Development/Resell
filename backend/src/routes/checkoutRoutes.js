const express = require('express');
const router = express.Router();
const { createCheckoutSession, handleWebhook } = require('../controllers/checkoutController');
const { protect } = require('../middleware/auth');
const { createCheckoutSessionValidation } = require('../middleware/validate');

// Webhook route — must use raw body, not JSON-parsed.
// This route is mounted BEFORE express.json() in server.js.
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// Checkout session creation — needs JSON parsing since this router is mounted before express.json()
router.post('/session', express.json(), protect, createCheckoutSessionValidation, createCheckoutSession);

module.exports = router;
