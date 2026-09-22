/**
 * Duplicate Detection Controller
 */

const Product = require('../models/Product');
const { duplicateDetector } = require('../services/duplicateDetection');
const { uploadToCloudinary } = require('../config/cloudinary');
const { perceptualHashFromBuffer } = require('../services/imageHash');
const { extractColorHistogram, compressImage } = require('../services/imageUtils');
const AppError = require('../utils/AppError');
const { imageProcessingQueue } = require('../queues');

/**
 * Check for duplicates without creating a listing
 * POST /api/listings/check-duplicate
 */
const checkDuplicate = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      throw new AppError('No image provided', 400, 'NO_IMAGE');
    }

    const file = req.files[0];
    const metadata = {
      category: req.body.category,
      price: req.body.price,
      brand: req.body.brand,
      model: req.body.model,
    };

    // Upload to Cloudinary first to get a URL
    const uploaded = await uploadToCloudinary(file.buffer, 'resell/temp');

    // Run duplicate detection
    const result = await duplicateDetector.detectDuplicate(
      uploaded.url,
      metadata,
      req.user._id
    );

    // Clean up temp image if not duplicate
    if (!result.isDuplicate) {
      await uploadToCloudinary.deleteFromCloudinary(uploaded.publicId).catch(() => {});
    }

    res.json({
      success: true,
      duplicate: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Upload images and check for duplicates
 * POST /api/listings/upload-images
 */
const uploadImages = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      throw new AppError('No images provided', 400, 'NO_FILES');
    }

    const results = [];
    
    for (const file of req.files) {
      // Phase 1: Compute perceptual hash
      const hash = await perceptualHashFromBuffer(file.buffer);

      // Phase 2: Upload to Cloudinary
      const uploaded = await uploadToCloudinary(file.buffer, 'resell/products');

      // Phase 3: Extract color histogram
      const colorHistogram = await extractColorHistogram(file.buffer);

      // Phase 4: Compress for faster processing
      const compressed = await compressImage(file.buffer, { width: 640, height: 480 });

      results.push({
        file,
        hash,
        uploaded,
        colorHistogram,
        compressedBuffer: compressed,
      });
    }

    // Check each image for duplicates
    const duplicateResults = [];
    for (const result of results) {
      const dupCheck = await duplicateDetector.detectDuplicate(
        result.uploaded.url,
        { category: req.body.category },
        req.user._id
      );
      
      duplicateResults.push({
        imageUrl: result.uploaded.url,
        publicId: result.uploaded.publicId,
        hash: result.hash,
        colorHistogram: result.colorHistogram,
        width: result.uploaded.width,
        height: result.uploaded.height,
        duplicateCheck: dupCheck,
      });
    }

    // Check if any image is a duplicate
    const hasDuplicate = duplicateResults.some(r => r.duplicateCheck.isDuplicate);
    
    if (hasDuplicate) {
      // Clean up uploaded images
      for (const r of duplicateResults) {
        await uploadToCloudinary.deleteFromCloudinary(r.publicId).catch(() => {});
      }
      
      const dupResult = duplicateResults.find(r => r.duplicateCheck.isDuplicate);
      throw new AppError(
        `Duplicate image detected (${(dupResult.duplicateCheck.confidence * 100).toFixed(1)}% confidence via ${dupResult.duplicateCheck.detectionMethod}). This image appears to be already listed.`,
        409,
        'DUPLICATE_IMAGE',
        {
          confidence: dupResult.duplicateCheck.confidence,
          detectionMethod: dupResult.duplicateCheck.detectionMethod,
          existingListingId: dupResult.duplicateCheck.existingListingId,
        }
      );
    }

    res.json({
      success: true,
      images: duplicateResults.map(r => ({
        url: r.imageUrl,
        publicId: r.publicId,
        width: r.width,
        height: r.height,
        hash: r.hash,
        colorHistogram: r.colorHistogram,
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new listing with duplicate detection
 * POST /api/listings
 */
const createListing = async (req, res, next) => {
  try {
    const {
      title,
      description,
      price,
      originalPrice,
      category,
      brand,
      model,
      condition,
      yearsUsed,
      specifications,
      location,
      images,
      currencyCode,
    } = req.body;

    // Validation
    if (!title || !description || !price || !category) {
      throw new AppError('Title, description, price and category are required', 400);
    }

    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new AppError('At least one image is required', 400);
    }

    // Verify images were uploaded through our system
    const validImages = images.filter(img => img.url && img.publicId);
    if (validImages.length === 0) {
      throw new AppError('Invalid image data', 400);
    }

    // Final duplicate check on all images
    for (const img of validImages) {
      if (img.hash) {
        // Quick hash check against database
        const existing = await Product.findOne({
          status: { $in: ['active', 'sold'] },
          'images.perceptualHash': img.hash,
          _id: { $ne: req.body.existingId }, // Allow editing own listing
        }).select('_id title').lean();

        if (existing && existing.seller.toString() !== req.user._id.toString()) {
          throw new AppError(
            `Duplicate detected: Image matches existing listing "${existing.title}"`,
            409,
            'DUPLICATE_IMAGE'
          );
        }
      }
    }

    // Create product
    const product = await Product.create({
      title,
      description,
      price,
      originalPrice: originalPrice || 0,
      currencyCode: currencyCode ? String(currencyCode).toUpperCase() : 'USD',
      category,
      brand: brand || '',
      model: model || '',
      condition: condition || 'good',
      yearsUsed: yearsUsed || 0,
      specifications: specifications || [],
      location: location || {},
      images: validImages.map((img, idx) => ({
        url: img.url,
        publicId: img.publicId,
        isPrimary: idx === 0,
        perceptualHash: img.hash || '',
        colorHistogram: img.colorHistogram || [],
        productType: img.productType || 'unknown',
        width: img.width || 0,
        height: img.height || 0,
      })),
      seller: req.user._id,
      aiAnalysis: {
        classification: { predictedCategory: '', confidence: 0 },
        conditionScore: 0,
        damageScore: 0,
        damageDescription: '',
        imageHashes: validImages.map(i => i.hash).filter(Boolean),
        duplicateMatch: { productId: null, similarity: 0 },
        priceRecommendation: {
          recommendedPrice: 0,
          minPrice: 0,
          maxPrice: 0,
          confidence: 0,
          explanation: 'AI analysis in progress...',
          factors: [],
          source: 'heuristic',
        },
        riskAssessment: { riskScore: 0, riskLevel: 'low', factors: [], assessedAt: new Date() },
        lastAnalyzedAt: new Date(),
      },
      duplicateInfo: {
        isDuplicate: false,
        duplicateOf: null,
        confidence: 0,
        detectionMethod: 'none',
        detectedAt: null,
        detectionDetails: {},
      },
    });

    // Queue background AI analysis
    try {
      await imageProcessingQueue.add('analyze-product', {
        productId: product._id.toString(),
        images: validImages.map(img => ({
          url: img.url,
          publicId: img.publicId,
          hash: img.hash,
          colorHistogram: img.colorHistogram,
        })),
        productData: {
          title,
          description,
          price,
          originalPrice: originalPrice || 0,
          category,
          brand: brand || '',
          model: model || '',
          condition: condition || 'good',
          yearsUsed: yearsUsed || 0,
          specifications: specifications || [],
          location: location || {},
        },
      });
    } catch (queueErr) {
      console.warn('[CreateListing] Could not queue AI analysis:', queueErr.message);
    }

    // Promote user to seller role
    if (req.user.role === 'buyer') {
      const User = require('../models/User');
      await User.updateOne({ _id: req.user._id }, { role: 'seller' });
    }

    const populated = await Product.findById(product._id)
      .populate('category', 'name slug')
      .populate('seller', 'name avatar');

    res.status(201).json({ success: true, product: populated });
  } catch (err) {
    next(err);
  }
};

/**
 * Get listing by ID
 * GET /api/listings/:id
 */
const getListing = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('category', 'name slug')
      .populate('seller', 'name avatar location bio averageResponseMinutes createdAt isVerified')
      .populate('duplicateInfo.duplicateOf', 'title images price status');

    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

    // Increment views (if not owner)
    if (!req.user || req.user._id.toString() !== product.seller._id.toString()) {
      Product.updateOne({ _id: product._id }, { $inc: { views: 1 } }).catch(() => {});
    }

    res.json({ success: true, product });
  } catch (err) {
    next(err);
  }
};

/**
 * Search listings
 * GET /api/listings/search
 */
const searchListings = async (req, res, next) => {
  try {
    const {
      category,
      priceMin,
      priceMax,
      condition,
      query,
      brand,
      model,
      sort = 'newest',
      page = 1,
      limit = 20,
    } = req.query;

    const filter = { 
      status: 'active', 
      'duplicateInfo.isDuplicate': false 
    };

    if (category) filter.category = category;
    if (brand) filter.brand = new RegExp(`^${brand}$`, 'i');
    if (model) filter.model = new RegExp(`^${model}$`, 'i');
    if (condition) filter.condition = condition;
    if (priceMin !== undefined) {
      filter.price = filter.price || {};
      filter.price.$gte = Number(priceMin);
    }
    if (priceMax !== undefined) {
      filter.price = filter.price || {};
      filter.price.$lte = Number(priceMax);
    }
    if (query) {
      filter.$text = { $search: query };
    }

    let sortObj = { createdAt: -1 };
    if (sort === 'price-asc') sortObj = { price: 1 };
    else if (sort === 'price-desc') sortObj = { price: -1 };
    else if (sort === 'oldest') sortObj = { createdAt: 1 };
    else if (sort === 'popular') sortObj = { views: -1, favoritesCount: -1 };

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(50, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    let productQuery = Product.find(filter)
      .populate('category', 'name slug')
      .populate('seller', 'name avatar location averageResponseMinutes')
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum);

    if (query) {
      productQuery = productQuery.select({ score: { $meta: 'textScore' } });
    }

    const [items, total] = await Promise.all([
      productQuery,
      Product.countDocuments(filter),
    ]);

    res.json({
      success: true,
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Report a listing
 * POST /api/listings/:id/report
 */
const reportListing = async (req, res, next) => {
  try {
    const { reason, duplicateOf } = req.body;
    const product = await Product.findById(req.params.id);

    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

    // Prevent self-reporting
    if (product.seller.toString() === req.user._id.toString()) {
      throw new AppError('Cannot report your own listing', 400, 'SELF_REPORT');
    }

    // Update product status
    product.isFlagged = true;
    product.flagReason = reason || 'user_report';
    product.status = 'flagged';

    if (duplicateOf) {
      product.duplicateInfo = {
        isDuplicate: true,
        duplicateOf,
        confidence: 0.9,
        detectionMethod: 'manual',
        detectedAt: new Date(),
        detectionDetails: { reportedBy: req.user._id },
      };
    }

    await product.save();

    // Create report record
    const Report = require('../models/Report');
    await Report.create({
      reporter: req.user._id,
      target: product._id,
      targetType: 'product',
      reason: reason || 'user_report',
      description: duplicateOf ? `Reported as duplicate of ${duplicateOf}` : '',
    });

    res.json({ success: true, message: 'Listing reported successfully' });
  } catch (err) {
    next(err);
  }
};

/**
 * Get duplicate statistics (admin)
 * GET /api/listings/admin/duplicate-stats
 */
const getDuplicateStats = async (req, res, next) => {
  try {
    const stats = await Product.aggregate([
      { $match: { status: { $in: ['active', 'sold', 'flagged'] } } },
      {
        $group: {
          _id: '$duplicateInfo.isDuplicate',
          count: { $sum: 1 },
        },
      },
    ]);

    const byMethod = await Product.aggregate([
      { $match: { 'duplicateInfo.isDuplicate': true } },
      {
        $group: {
          _id: '$duplicateInfo.detectionMethod',
          count: { $sum: 1 },
          avgConfidence: { $avg: '$duplicateInfo.confidence' },
        },
      },
    ]);

    const recent = await Product.find({ 'duplicateInfo.isDuplicate': true })
      .populate('duplicateInfo.duplicateOf', 'title')
      .sort({ 'duplicateInfo.detectedAt': -1 })
      .limit(20)
      .select('title duplicateInfo seller createdAt');

    res.json({
      success: true,
      stats: {
        total: stats.reduce((sum, s) => sum + s.count, 0),
        duplicates: stats.find(s => s._id)?.count || 0,
        unique: stats.find(s => !s._id)?.count || 0,
        byMethod,
        recentDuplicates: recent,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  checkDuplicate,
  uploadImages,
  createListing,
  getListing,
  searchListings,
  reportListing,
  getDuplicateStats,
};