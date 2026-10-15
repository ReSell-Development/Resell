const mongoose = require('mongoose');

const VALID_TRANSITIONS = {
  pending_payment: ['paid', 'payment_failed', 'cancelled'],
  paid: ['shipped', 'refunded', 'cancelled'],
  shipped: ['delivered', 'disputed'],
  delivered: ['completed', 'disputed'],
  completed: [],
  payment_failed: ['cancelled'],
  cancelled: [],
  refunded: [],
  disputed: [],
};

const addressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: '', trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, default: '', trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', default: null, index: true },
    salePrice: { type: Number, required: true, min: [1, 'Sale price must be positive'] },
    platformFee: { type: Number, default: 0, min: 0 },
    netAmount: { type: Number, required: true },
    currencyCode: { type: String, default: 'USD', uppercase: true },
    status: {
      type: String,
      enum: Object.keys(VALID_TRANSITIONS),
      default: 'pending_payment',
    },
    stripeSessionId: { type: String, default: null, sparse: true },
    stripePaymentIntentId: { type: String, default: null },
    stripeRefundId: { type: String, default: null },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded', 'failed'],
      default: 'unpaid',
    },
    shippingAddress: { type: addressSchema, default: null },
    trackingNumber: { type: String, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    history: [
      {
        status: { type: String, required: true },
        actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
        note: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true }
);

saleSchema.index({ stripeSessionId: 1 }, { sparse: true, unique: true });
saleSchema.index({ buyer: 1, createdAt: -1 });
saleSchema.index({ seller: 1, createdAt: -1 });
saleSchema.index({ status: 1 });

saleSchema.methods.canTransition = function (newStatus) {
  const allowed = VALID_TRANSITIONS[this.status];
  return allowed && allowed.includes(newStatus);
};

saleSchema.methods.transition = function (newStatus, actorId, note = '') {
  if (!this.canTransition(newStatus)) {
    throw new Error(`Cannot transition from ${this.status} to ${newStatus}`);
  }
  this.status = newStatus;
  this.history.push({ status: newStatus, actor: actorId, at: new Date(), note });
};

module.exports = mongoose.model('Sale', saleSchema);
module.exports.addressSchema = addressSchema;
module.exports.VALID_TRANSITIONS = VALID_TRANSITIONS;

// Sale statuses that qualify a purchase for reviewing. A buyer may only
// review after the order has actually been received (delivered/completed) —
// cancelled, refunded and failed payments never qualify.
module.exports.REVIEWABLE_STATUSES = ['delivered', 'completed'];
