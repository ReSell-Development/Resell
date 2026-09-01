const mongoose = require('mongoose');

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
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    salePrice: { type: Number, required: true },
    platformFee: { type: Number, default: 0 },
    netAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['initiated', 'completed', 'cancelled', 'disputed'],
      default: 'completed',
    },
    shippingAddress: { type: addressSchema, default: null },
  },
  { timestamps: true }
);

saleSchema.index({ seller: 1, createdAt: -1 });

saleSchema.schema.statics = saleSchema.statics || {};
saleSchema.statics.AddressSchema = addressSchema;

module.exports = mongoose.model('Sale', saleSchema);
