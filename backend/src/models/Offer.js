const mongoose = require('mongoose');

const VALID_TRANSITIONS = {
  pending: ['accepted', 'rejected', 'countered', 'withdrawn', 'expired'],
  countered: ['accepted', 'rejected', 'withdrawn', 'expired'],
  accepted: [],
  rejected: [],
  withdrawn: [],
  expired: [],
};

const offerSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: [1, 'Amount must be positive'] },
    currencyCode: { type: String, default: 'USD', uppercase: true },
    message: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: Object.keys(VALID_TRANSITIONS), default: 'pending' },
    parentOffer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', default: null },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    history: [
      {
        status: String,
        actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
        note: String,
      },
    ],
  },
  { timestamps: true }
);

offerSchema.index({ buyer: 1, createdAt: -1 });
offerSchema.index({ seller: 1, createdAt: -1 });
offerSchema.index({ product: 1, status: 1 });

offerSchema.plugin(function versionPlugin(schema) {
  schema.add({ __v: { type: Number, default: 0 } });
});

offerSchema.methods.canTransition = function (newStatus) {
  const allowed = VALID_TRANSITIONS[this.status];
  return allowed && allowed.includes(newStatus);
};

module.exports = mongoose.model('Offer', offerSchema);
