const Product = require('../models/Product');
const Sale = require('../models/Sale');
const AppError = require('../utils/AppError');
const stripeService = require('../services/stripeService');

const createCheckoutSession = async (req, res, next) => {
  try {
    const { productId, shippingAddress } = req.body;
    if (!productId) throw new AppError('Product ID is required', 400, 'VALIDATION_ERROR');

    const product = await Product.findById(productId);
    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');
    if (product.status !== 'active') {
      throw new AppError('Product is no longer available', 409, 'PRODUCT_UNAVAILABLE');
    }
    if (product.seller.toString() === req.user._id.toString()) {
      throw new AppError('Cannot purchase your own product', 400, 'SELF_PURCHASE');
    }

    // Atomic lock: mark product as pending to prevent double-purchase
    const locked = await Product.findOneAndUpdate(
      { _id: productId, status: 'active' },
      { $set: { status: 'pending' } },
      { new: true }
    );

    if (!locked) {
      throw new AppError('Product was just purchased by someone else', 409, 'PRODUCT_UNAVAILABLE');
    }

    try {
      const { session, sale } = await stripeService.createCheckoutSession({
        product: locked,
        buyer: req.user,
        shippingAddress,
      });

      res.status(201).json({
        success: true,
        sessionId: session.id,
        url: session.url,
        saleId: sale._id,
      });
    } catch (err) {
      // Rollback product status if session creation fails
      await Product.findByIdAndUpdate(productId, { status: 'active' });
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Stripe] STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;
  try {
    const stripe = stripeService.getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`[Stripe] Webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  let result;
  switch (event.type) {
    case 'checkout.session.completed':
      result = await stripeService.handleCheckoutCompleted(event);
      break;
    case 'checkout.session.expired':
      result = await stripeService.handleSessionExpired(event);
      break;
    case 'payment_intent.payment_failed':
      result = await stripeService.handlePaymentFailed(event);
      break;
    default:
      result = { processed: false, reason: 'unhandled_event' };
  }

  res.json({ received: true, result });
};

module.exports = { createCheckoutSession, handleWebhook };
