const Product = require('../models/Product');
const Sale = require('../models/Sale');
const Offer = require('../models/Offer');
const AppError = require('../utils/AppError');
const stripeService = require('../services/stripeService');
const { notify } = require('../services/notificationService');

// Statuses that mean money was captured for a Sale tied to an offer —
// an offer in this state can no longer be used to start a new checkout.
const CONSUMED_SALE_STATUSES = ['paid', 'shipped', 'delivered', 'completed'];

const createCheckoutSession = async (req, res, next) => {
  try {
    const { productId, shippingAddress, offerId } = req.body;
    if (!productId) throw new AppError('Product ID is required', 400, 'VALIDATION_ERROR');

    const product = await Product.findById(productId);
    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');
    if (product.status !== 'active') {
      throw new AppError('Product is no longer available', 409, 'PRODUCT_UNAVAILABLE');
    }
    if (product.seller.toString() === req.user._id.toString()) {
      throw new AppError('Cannot purchase your own product', 400, 'SELF_PURCHASE');
    }

    // When an offerId is supplied, validate the accepted offer before
    // creating the session. The negotiated amount is only honored for
    // the offer's buyer, on the offer's own product, while accepted.
    let offer = null;
    if (offerId) {
      offer = await Offer.findById(offerId);
      if (!offer) throw new AppError('Offer not found', 404, 'NOT_FOUND');
      if (offer.status !== 'accepted') {
        throw new AppError('Offer is not accepted', 409, 'OFFER_NOT_ACCEPTED');
      }
      if (offer.buyer.toString() !== req.user._id.toString()) {
        throw new AppError('Only the offer buyer can purchase with this offer', 403, 'FORBIDDEN');
      }
      if (offer.product.toString() !== productId) {
        throw new AppError('Offer does not apply to this product', 400, 'OFFER_PRODUCT_MISMATCH');
      }
      if (offer.seller.toString() !== product.seller.toString()) {
        throw new AppError('Offer seller does not match the product seller', 400, 'OFFER_SELLER_MISMATCH');
      }
      if ((offer.currencyCode || 'USD') !== (product.currencyCode || 'USD')) {
        throw new AppError('Offer currency does not match the product currency', 400, 'CURRENCY_MISMATCH');
      }

      const consumed = await Sale.findOne({
        offer: offer._id,
        status: { $in: CONSUMED_SALE_STATUSES },
      });
      if (consumed) {
        throw new AppError('Offer has already been used for a purchase', 409, 'OFFER_ALREADY_CONSUMED');
      }
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
        offer,
      });

      // Notify the seller a buyer started checkout on their listing
      await notify({
        recipient: locked.seller,
        type: 'order',
        payload: { saleId: sale._id, productId: locked._id, senderId: req.user._id },
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
