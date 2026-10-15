const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    // The qualifying verified purchase this review belongs to.
    // Set server-side only — never taken from client input.
    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      default: null,
      index: true,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true }
);

// One review per qualifying purchase — verified-purchase gating means a
// buyer may review each genuine transaction once. (Replaces the previous
// {seller, buyer} unique index, which limited a buyer to a single
// lifetime review per seller even across multiple genuine purchases.)
reviewSchema.index({ sale: 1 }, { unique: true, sparse: true });

// Review lookups
reviewSchema.index({ product: 1, createdAt: -1 });
reviewSchema.index({ seller: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
