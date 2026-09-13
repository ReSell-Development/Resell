const Stripe = require('stripe');
const Sale = require('../models/Sale');
const Product = require('../models/Product');

const PLATFORM_FEE_PERCENT = 5;

let stripeInstance = null;

function getStripe() {
  if (!stripeInstance && process.env.STRIPE_SECRET_KEY) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeInstance;
}

function calculateFee(amount) {
  const fee = Math.round(amount * (PLATFORM_FEE_PERCENT / 100));
  return { platformFee: fee, netAmount: amount - fee };
}

async function createCheckoutSession({ product, buyer, shippingAddress }) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY.');

  const { platformFee, netAmount } = calculateFee(product.price);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: (product.currencyCode || 'USD').toLowerCase(),
          product_data: {
            name: product.title,
            description: product.description?.slice(0, 500) || '',
            images: product.images?.length > 0 ? [product.images[0].url] : [],
          },
          unit_amount: product.price,
        },
        quantity: 1,
      },
    ],
    metadata: {
      productId: product._id.toString(),
      buyerId: buyer._id.toString(),
      sellerId: product.seller.toString(),
    },
    success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/order-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/checkout/${product._id}?cancelled=true`,
  });

  const sale = await Sale.create({
    product: product._id,
    seller: product.seller,
    buyer: buyer._id,
    salePrice: product.price,
    platformFee,
    netAmount,
    currencyCode: product.currencyCode || 'USD',
    status: 'pending_payment',
    stripeSessionId: session.id,
    shippingAddress,
    history: [{ status: 'pending_payment', actor: buyer._id, at: new Date(), note: 'Checkout session created' }],
  });

  return { session, sale };
}

async function handleCheckoutCompleted(event) {
  const session = event.data.object;
  const { productId, buyerId, sellerId } = session.metadata || {};

  const sale = await Sale.findOne({ stripeSessionId: session.id });
  if (!sale) {
    console.error(`[Stripe] No sale found for session ${session.id}`);
    return { processed: false, reason: 'no_sale' };
  }

  // Idempotency: skip if already paid
  if (sale.status !== 'pending_payment') {
    console.log(`[Stripe] Sale ${sale._id} already in status ${sale.status}, skipping`);
    return { processed: false, reason: 'already_processed' };
  }

  // Lock the product atomically
  const product = await Product.findOneAndUpdate(
    { _id: productId, status: 'active' },
    { $set: { status: 'sold' } },
    { new: true }
  );

  if (!product) {
    console.error(`[Stripe] Product ${productId} no longer active, releasing payment`);
    // Product was taken — refund via Stripe
    const stripe = getStripe();
    if (stripe && session.payment_intent) {
      await stripe.refunds.create({ payment_intent: session.payment_intent });
    }
    sale.transition('payment_failed', null, 'Product no longer available');
    sale.paymentStatus = 'failed';
    await sale.save();
    return { processed: false, reason: 'product_unavailable' };
  }

  sale.transition('paid', null, `Stripe payment confirmed: ${session.payment_intent}`);
  sale.paymentStatus = 'paid';
  sale.stripePaymentIntentId = session.payment_intent;
  await sale.save();

  return { processed: true, saleId: sale._id };
}

async function handleSessionExpired(event) {
  const session = event.data.object;
  const sale = await Sale.findOne({ stripeSessionId: session.id });
  if (!sale || sale.status !== 'pending_payment') {
    return { processed: false, reason: 'not_pending' };
  }

  // Release the product back to active
  await Product.findByIdAndUpdate(sale.product, { status: 'active' });

  sale.transition('payment_failed', null, 'Checkout session expired');
  sale.paymentStatus = 'failed';
  await sale.save();

  return { processed: true, saleId: sale._id };
}

async function handlePaymentFailed(event) {
  const paymentIntent = event.data.object;
  const sale = await Sale.findOne({ stripePaymentIntentId: paymentIntent.id });
  if (!sale || sale.status !== 'pending_payment') {
    return { processed: false, reason: 'not_pending' };
  }

  await Product.findByIdAndUpdate(sale.product, { status: 'active' });

  sale.transition('payment_failed', null, 'Payment failed');
  sale.paymentStatus = 'failed';
  await sale.save();

  return { processed: true, saleId: sale._id };
}

async function createRefund(sale) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');

  if (!sale.stripePaymentIntentId) {
    throw new Error('No payment intent to refund');
  }

  const refund = await stripe.refunds.create({
    payment_intent: sale.stripePaymentIntentId,
  });

  sale.stripeRefundId = refund.id;
  sale.paymentStatus = 'refunded';
  sale.transition('refunded', null, `Stripe refund: ${refund.id}`);
  await sale.save();

  // Release the product
  await Product.findByIdAndUpdate(sale.product, { status: 'active' });

  return refund;
}

module.exports = {
  getStripe,
  calculateFee,
  createCheckoutSession,
  handleCheckoutCompleted,
  handleSessionExpired,
  handlePaymentFailed,
  createRefund,
  PLATFORM_FEE_PERCENT,
};
