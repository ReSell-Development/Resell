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
        // Per-image analysis
        perceptualHash: { type: String, default: '' },
        cnnFeatures: { type: [Number], default: [] }, // 1280D MobileNetV2 features
        colorHistogram: { type: [Number], default: [] }, // 48-bin color histogram
        productType: { type: String, default: 'unknown' },
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 },
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
      enum: ['active', 'sold', 'pending', 'rejected', 'removed', 'flagged'],
      default: 'active',
    },
    isFlagged: { type: Boolean, default: false },
    flagReason: { type: String, default: '' },

    // Physical-product identity (serial/IMEI/VIN registry entry)
    productIdentity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductIdentity',
      default: null,
      index: true,
    },

    // Duplicate detection fields
    duplicateInfo: {
      isDuplicate: { type: Boolean, default: false, index: true },
      duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
      confidence: { type: Number, default: 0, min: 0, max: 1 },
      detectionMethod: { 
        type: String, 
        enum: ['perceptual_hash', 'perceptual_hash_exact', 'cnn_features', 'cnn_features_high_confidence', 'cnn_sift_combined', 'manual'],
        default: 'perceptual_hash' 
      },
      detectedAt: { type: Date, default: null },
      detectionDetails: {
        hammingDistance: { type: Number, default: null },
        cnnSimilarity: { type: Number, default: null },
        siftScore: { type: Number, default: null },
        stageTimings: {
          stage1_ms: { type: Number, default: 0 },
          stage2_ms: { type: Number, default: 0 },
          stage3_ms: { type: Number, default: 0 },
        },
        error: { type: String, default: '' },
      },
    },

    views: { type: Number, default: 0 },
    favoritesCount: { type: Number, default: 0 },

    // AI analysis fields (existing)
    aiAnalysis: {
      classification: {
        predictedCategory: { type: String, default: '' },
        confidence: { type: Number, default: 0 },
      },
      conditionScore: { type: Number, default: 0, min: 0, max: 100 },
      damageScore: { type: Number, default: 0, min: 0, max: 100 },
      damageDescription: { type: String, default: '' },
      imageHashes: [{ type: String }], // Legacy - keeping for backward compatibility
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

// Indexes for performance
productSchema.index({ title: 'text', description: 'text', brand: 'text', model: 'text' });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ price: 1 });
productSchema.index({ 'location.city': 1 });
productSchema.index({ seller: 1, status: 1 });
productSchema.index({ 'aiAnalysis.riskAssessment.riskScore': -1 });

// Duplicate detection indexes
productSchema.index({ 'duplicateInfo.isDuplicate': 1, status: 1 });
productSchema.index({ 'duplicateInfo.duplicateOf': 1 });
productSchema.index({ 'images.perceptualHash': 1, status: 1 });
productSchema.index({ 'images.cnnFeatures': 1 }); // For future vector search

// Compound indexes for common queries
productSchema.index({ category: 1, price: 1, status: 1 });
productSchema.index({ seller: 1, createdAt: -1 });

module.exports = mongoose.model('Product', productSchema);