const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [120, 'Title cannot exceed 120 characters'],
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      maxlength: [4000, 'Description cannot exceed 4000 characters'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    originalPrice: { type: Number, default: 0 },
    currencyCode: {
      type: String,
      default: 'USD',
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
    },
    brand: { type: String, default: '', trim: true },
    model: { type: String, default: '', trim: true },
    condition: {
      type: String,
      enum: ['new', 'like-new', 'good', 'fair', 'poor'],
      default: 'good',
    },
    yearsUsed: { type: Number, default: 0, min: 0 },
    specifications: [
      {
        key: String,
        value: String,
      },
    ],
    location: {
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      country: { type: String, default: '' },
    },
    images: [
      {
        url: { type: String, required: true },
        publicId: { type: String, default: '' },
        isPrimary: { type: Boolean, default: false },
      },
    ],
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'sold', 'pending', 'rejected', 'removed'],
      default: 'active',
    },
    isFlagged: { type: Boolean, default: false },
    flagReason: { type: String, default: '' },
    views: { type: Number, default: 0 },
    favoritesCount: { type: Number, default: 0 },

    // AI analysis fields
    aiAnalysis: {
      classification: {
        predictedCategory: { type: String, default: '' },
        confidence: { type: Number, default: 0 },
      },
      conditionScore: { type: Number, default: 0, min: 0, max: 100 },
      damageScore: { type: Number, default: 0, min: 0, max: 100 },
      damageDescription: { type: String, default: '' },
      imageHashes: [{ type: String }],
      duplicateMatch: {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
        similarity: { type: Number, default: 0 },
      },
      priceRecommendation: {
        recommendedPrice: { type: Number, default: 0 },
        minPrice: { type: Number, default: 0 },
        maxPrice: { type: Number, default: 0 },
        confidence: { type: Number, default: 0 },
        explanation: { type: String, default: '' },
        factors: [{ type: String }],
        generatedAt: { type: Date, default: Date.now },
        refinedAt: { type: Date, default: null },
        refinementAttempts: { type: Number, default: 0 },
        source: { type: String, enum: ['ml-model', 'heuristic'], default: 'heuristic' },
      },
      riskAssessment: {
        riskScore: { type: Number, default: 0, min: 0, max: 100 },
        riskLevel: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
        factors: [{ type: String }],
        assessedAt: { type: Date, default: Date.now },
      },
      lastAnalyzedAt: { type: Date, default: Date.now },
    },
  },
  { timestamps: true }
);

productSchema.index({ title: 'text', description: 'text', brand: 'text', model: 'text' });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ price: 1 });
productSchema.index({ 'location.city': 1 });
productSchema.index({ seller: 1, status: 1 });
productSchema.index({ 'aiAnalysis.riskAssessment.riskScore': -1 });

module.exports = mongoose.model('Product', productSchema);
