const rateLimit = require('express-rate-limit');

const isTest = process.env.NODE_ENV === 'test';

const productCreateLimiter = isTest ? (req, res, next) => next() : rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { success: false, code: 'RATE_LIMIT', message: 'Too many products created. Try again later.' },
});

const chatLimiter = isTest ? (req, res, next) => next() : rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { success: false, code: 'RATE_LIMIT', message: 'Too many messages. Slow down.' },
});

module.exports = { productCreateLimiter, chatLimiter };
