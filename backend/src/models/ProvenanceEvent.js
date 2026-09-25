const mongoose = require('mongoose');

/**
 * ProvenanceEvent - hash-chained ownership history for a ProductIdentity.
 *
 * hash = SHA256(previousHash + event data)
 * Chain starts with previousHash = 'GENESIS'.
 * Events are generated server-side only.
 */
const provenanceEventSchema = new mongoose.Schema(
  {
    productIdentityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductIdentity',
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: ['registered', 'listed', 'sold', 'ownership_transferred', 'reported', 'possession_verified'],
      required: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    transactionId: { type: String, default: null },
    timestamp: { type: Date, required: true },
    previousHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { timestamps: true }
);

provenanceEventSchema.index({ productIdentityId: 1, timestamp: 1 });
provenanceEventSchema.index({ productIdentityId: 1, eventType: 1 });

module.exports = mongoose.model('ProvenanceEvent', provenanceEventSchema);
