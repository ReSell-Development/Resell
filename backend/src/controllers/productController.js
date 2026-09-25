const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Review = require('../models/Review');
const Sale = require('../models/Sale');
const { REVIEWABLE_STATUSES } = require('../models/Sale');
const AppError = require('../utils/AppError');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const {
  perceptualHashFromBuffer,
  mirrorPerceptualHashFromBuffer,
  hammingDistance,
} = require('../services/imageHash');
const computerVision = require('../services/computerVision');
const { calculateRecommendedPrice } = require('../services/priceRecommendation');
const { detectRisk } = require('../services/fraudDetection');
const { findSimilar } = require('../services/similarProducts');
const { imageProcessingQueue } = require('../queues');

const buildFilters = (query) => {
  const filter = { status: 'active' };

  if (query.q) {
    filter.$text = { $search: query.q };
  }
  if (query.category) filter.category = query.category;
  if (query.brand) {
    const escaped = query.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.brand = new RegExp(`^${escaped}$`, 'i');
  }
  if (query.condition) filter.condition = query.condition;
  if (query.minPrice !== undefined && query.minPrice !== '' && query.minPrice !== null) {
    filter.price = filter.price || {};
    filter.price.$gte = Number(query.minPrice);
  }
  if (query.maxPrice !== undefined && query.maxPrice !== '' && query.maxPrice !== null) {
    filter.price = filter.price || {};
    filter.price.$lte = Number(query.maxPrice);
  }
  if (query.location) {
    const escaped = query.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter['location.city'] = new RegExp(escaped, 'i');
  }
  if (query.seller) filter.seller = query.seller;

  return filter;
};

const buildSort = (sort) => {
  switch (sort) {
    case 'price-asc':
      return { price: 1 };
    case 'price-desc':
      return { price: -1 };
    case 'newest':
      return { createdAt: -1 };
    case 'oldest':
      return { createdAt: 1 };
    case 'popular':
      return { views: -1, favoritesCount: -1 };
    default:
      return { createdAt: -1 };
  }
};

const getProducts = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    const skip = (page - 1) * limit;

    const filter = buildFilters(req.query);
    const isTextSearch = !!filter.$text;

    // When using $text search, MongoDB requires sorting by textScore
    let sort;
    if (isTextSearch) {
      sort = { score: { $meta: 'textScore' } };
    } else {
      sort = buildSort(req.query.sort);
    }

    let query = Product.find(filter)
      .populate('category', 'name slug')
      .populate('seller', 'name avatar location averageResponseMinutes')
      .sort(sort)
      .skip(skip)
      .limit(limit);

    // Add textScore to returned documents when using text search
    if (isTextSearch) {
      query = query.select({ score: { $meta: 'textScore' } });
    }

    const [items, total] = await Promise.all([
      query,
      Product.countDocuments(filter),
    ]);

    res.json({
      success: true,
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

const getProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('category', 'name slug')
      .populate('seller', 'name avatar location bio averageResponseMinutes createdAt isVerified');

    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

    // Increment views (best-effort)
    if (!req.user || req.user._id.toString() !== product.seller._id.toString()) {
      Product.updateOne({ _id: product._id }, { $inc: { views: 1 } }).catch(() => {});
    }

    res.json({ success: true, product });
  } catch (err) {
    next(err);
  }
};

// Maximum hamming distance for 64-bit pHash to consider two images as duplicates.
// Distance 0-8: very likely duplicate (crop/recompress variants).
// Distance 9-12: possibly similar (captured to be safe).
// Distance 13+: genuinely different images.
// Threshold of 12 matches fraudDetection.js HASH_SIMILARITY_THRESHOLD and is
// validated against real photographs with a margin of 18 points to the next
// same-category different-product minimum distance (30).
const DUPLICATE_HASH_THRESHOLD = 12;

const uploadImages = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      throw new AppError('No images provided', 400, 'NO_FILES');
    }

    // Phase 1: Compute perceptual hashes for ALL incoming images before any
    // Cloudinary upload. This ensures we can reject duplicates without leaving
    // orphaned files on Cloudinary.
    const fileHashes = [];
    for (const file of req.files) {
      const hash = await perceptualHashFromBuffer(file.buffer);
      fileHashes.push({ file, hash });
    }

    // Phase 2: Check each hash against existing active/sold products.
    // Scoped to same category when available, otherwise global.
    // Limit to 500 candidates for performance.
    for (const { hash } of fileHashes) {
      const candidateFilter = {
        status: { $in: ['active', 'sold'] },
        'aiAnalysis.imageHashes': { $exists: true, $ne: [] },
      };
      if (req.body.category) {
        candidateFilter.category = req.body.category;
      }

      const candidates = await Product.find(candidateFilter)
        .select('title seller aiAnalysis.imageHashes')
        .limit(500);

      for (const candidate of candidates) {
        const candidateHashes = candidate.aiAnalysis?.imageHashes || [];
        for (const candidateHash of candidateHashes) {
          const distance = hammingDistance(hash, candidateHash);
          if (distance <= DUPLICATE_HASH_THRESHOLD) {
            const similarityPct = Math.round((1 - distance / 64) * 100);
            throw new AppError(
              `Duplicate image detected (~${similarityPct}% similar to existing listing "${candidate.title}"). This image is already used in another listing.`,
              409,
              'DUPLICATE_IMAGE'
            );
          }
        }
      }
    }

    // Phase 3: All hashes are unique — proceed with Cloudinary upload + CV analysis.
    const results = [];
    for (const file of req.files) {
      try {
        const uploaded = await uploadToCloudinary(file.buffer, 'resell/products');
        const hash = fileHashes.find((fh) => fh.file === file)?.hash;

        // CV analysis
        const [condition, damage, classification] = await Promise.all([
          computerVision.assessCondition(file.buffer),
          computerVision.detectDamage(file.buffer),
          computerVision.classifyProduct(file.buffer, {
            filename: file.originalname,
            title: req.body.title,
          }),
        ]);

        results.push({
          url: uploaded.url,
          publicId: uploaded.publicId,
          width: uploaded.width,
          height: uploaded.height,
          hash,
          analysis: {
            conditionScore: condition.score,
            damageScore: damage.score,
            predictedCategory: classification.category,
            classificationConfidence: classification.confidence,
          },
        });
      } catch (err) {
        console.error('[Upload] Image processing error:', err.message);
      }
    }

    if (results.length === 0) {
      throw new AppError('Failed to process images', 500, 'IMAGE_PROCESSING_FAILED');
    }

    // Average CV scores across images
    const avgCondition =
      results.reduce((s, r) => s + (r.analysis?.conditionScore || 0), 0) / results.length;
    const avgDamage =
      results.reduce((s, r) => s + (r.analysis?.damageScore || 0), 0) / results.length;
    const predictedCategory = results[0]?.analysis?.predictedCategory || 'Other';

    res.json({
      success: true,
      images: results.map((r) => ({
        url: r.url,
        publicId: r.publicId,
        width: r.width,
        height: r.height,
        hash: r.hash,
      })),
      analysis: {
        conditionScore: Math.round(avgCondition),
        damageScore: Math.round(avgDamage),
        predictedCategory,
        classificationConfidence: results[0]?.analysis?.classificationConfidence || 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Server-side re-verification of image analysis.
 *
 * Never trust client-submitted aiAnalysis values: download the stored
 * images and recompute condition/damage/classification with our own
 * heuristic CV pipeline before they influence pricing or storage.
 */
const reverifyImageAnalysis = async (images = [], { title } = {}) => {
  const results = [];
  for (const img of images) {
    if (!img?.url) continue;
    try {
      const res = await fetch(img.url);
      if (!res.ok) throw new Error(`Image fetch failed with status ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      const [condition, damage] = await Promise.all([
        computerVision.assessCondition(buffer),
        computerVision.detectDamage(buffer),
      ]);
      results.push({ conditionScore: condition.score, damageScore: damage.score });
    } catch (err) {
      console.error('[CreateProduct] Image re-analysis failed:', err.message);
    }
  }

  if (results.length === 0) {
    return null;
  }

  const avgCondition =
    results.reduce((s, r) => s + r.conditionScore, 0) / results.length;
  const avgDamage =
    results.reduce((s, r) => s + r.damageScore, 0) / results.length;
  const classification = await computerVision.classifyProduct(null, { title });

  return {
    conditionScore: Math.round(avgCondition),
    damageScore: Math.round(avgDamage),
    predictedCategory: classification.category,
    classificationConfidence: classification.confidence,
  };
};

const createProduct = async (req, res, next) => {
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

    if (!title || !description || !price || !category) {
      throw new AppError('Title, description, price and category are required', 400);
    }

    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new AppError('At least one image is required', 400);
    }

    // Create product with minimal AI analysis (hashes from upload)
    // Full AI analysis will be done in background job
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
      images: images.map((img, idx) => ({
        url: img.url,
        publicId: img.publicId,
        isPrimary: idx === 0,
      })),
      seller: req.user._id,
      aiAnalysis: {
        classification: {
          predictedCategory: '',
          confidence: 0,
        },
        conditionScore: 0,
        damageScore: 0,
        damageDescription: '',
        imageHashes: (images || []).map((i) => i.hash).filter(Boolean),
        priceRecommendation: {
          recommendedPrice: 0,
          minPrice: 0,
          maxPrice: 0,
          confidence: 0,
          explanation: 'AI analysis in progress...',
          factors: [],
          source: 'heuristic',
        },
        lastAnalyzedAt: new Date(),
      },
    });

    // Queue background job for full AI analysis
    await imageProcessingQueue.add('analyze-product', {
      productId: product._id.toString(),
      images: images.map(img => ({
        url: img.url,
        publicId: img.publicId,
        hash: img.hash,
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

    // Risk assessment (basic - based on hashes only)
    const risk = await detectRisk({
      product,
      hashes: product.aiAnalysis.imageHashes,
      aiAnalysis: product.aiAnalysis,
    });
    product.aiAnalysis.riskAssessment = {
      riskScore: risk.riskScore,
      riskLevel: risk.riskLevel,
      factors: risk.factors,
      assessedAt: new Date(),
    };
    await product.save();

    // Promote user to seller role on first listing
    if (req.user.role === 'buyer') {
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
 * Download an image buffer from a URL. Uses the same fetch pattern as
 * reverifyImageAnalysis above.
 */
const fetchImageBuffer = async (url) => {
  if (!url || typeof url !== 'string') throw new Error('Image URL missing');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch failed with status ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

/**
 * Clean up Cloudinary assets that are no longer needed (a rejected update
 * or a deleted listing). Only deletes publicIds not referenced by any
 * other listing so shared assets are never destroyed. Uses the existing
 * deleteFromCloudinary mechanism (safe no-op when Cloudinary is not
 * configured) and logs — never silently swallows — cleanup failures.
 */
const cleanupUnreferencedImages = async (publicIds, productId) => {
  for (const publicId of publicIds) {
    try {
      const referenced = await Product.exists({
        'images.publicId': publicId,
        _id: { $ne: productId },
      });
      if (!referenced) await deleteFromCloudinary(publicId);
    } catch (err) {
      console.error('[Cloudinary] Cleanup failed for', publicId, '-', err.message);
    }
  }
};

const updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

    if (
      product.seller.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin'
    ) {
      throw new AppError('Not authorized to edit this listing', 403, 'FORBIDDEN');
    }

    const allowed = [
      'title',
      'description',
      'price',
      'originalPrice',
      'category',
      'brand',
      'model',
      'condition',
      'yearsUsed',
      'specifications',
      'location',
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) product[key] = req.body[key];
    }

    const incoming =
      req.body.images && Array.isArray(req.body.images) && req.body.images.length > 0
        ? req.body.images
        : null;

    if (!incoming) {
      // No image change — existing behavior
      await product.save();

      const populated = await Product.findById(product._id)
        .populate('category', 'name slug')
        .populate('seller', 'name avatar');

      return res.json({ success: true, product: populated });
    }

    const keyOf = (img) => img.publicId || img.url;
    const currentKeys = new Set(product.images.map((i) => keyOf(i)).filter(Boolean));

    // The image set is "unchanged" when every incoming image is already on
    // the listing — edits that only touch other fields keep existing behavior.
    const imagesChanged =
      incoming.length !== product.images.length ||
      incoming.some((img) => !currentKeys.has(keyOf(img)));

    if (!imagesChanged) {
      product.images = incoming.map((img, idx) => ({
        url: img.url,
        publicId: img.publicId,
        isPrimary: idx === 0,
      }));
      await product.save();

      const populated = await Product.findById(product._id)
        .populate('category', 'name slug')
        .populate('seller', 'name avatar');

      return res.json({ success: true, product: populated });
    }

    // ---- Edit-time image re-verification (same defenses as creation) ----
    // The product is NOT saved until every new image passes verification,
    // so a rejected edit can never leave a partially updated listing.
    const category = req.body.category !== undefined ? req.body.category : product.category;
    const newPublicIds = [];
    const verified = [];

    try {
      for (const img of incoming) {
        const key = keyOf(img);
        const retained = currentKeys.has(key);
        let hash = null;
        let mirrorHash = null;

        // Hashes are always computed server-side — client-submitted
        // hashes are never trusted.
        try {
          const buffer = await fetchImageBuffer(img.url);
          hash = await perceptualHashFromBuffer(buffer);
          mirrorHash = await mirrorPerceptualHashFromBuffer(buffer);
        } catch (err) {
          // Retained images may fall back to their stored hash; brand-new
          // images must be verifiable server-side or the edit is rejected.
          const stored = product.images.find((i) => keyOf(i) === key);
          if (retained && stored && stored.perceptualHash) {
            hash = stored.perceptualHash;
          } else {
            throw new AppError(
              'Could not verify one or more images. Images must be uploaded through ReSell.',
              400,
              'IMAGE_VERIFICATION_FAILED'
            );
          }
        }

        if (!retained && img.publicId) newPublicIds.push(img.publicId);
        verified.push({ img, hash, mirrorHash, isNew: !retained });
      }

      // Duplicate detection for NEW images — identical rules to the
      // upload-time check: active/sold listings, scoped to the listing's
      // category, hamming distance <= DUPLICATE_HASH_THRESHOLD. Both the
      // normal and the mirrored hash are probed so a flipped copy of an
      // existing image cannot slip through.
      const candidateFilter = {
        _id: { $ne: product._id },
        status: { $in: ['active', 'sold'] },
        'aiAnalysis.imageHashes': { $exists: true, $ne: [] },
      };
      if (category) candidateFilter.category = category;

      const candidates = await Product.find(candidateFilter)
        .select('title aiAnalysis.imageHashes')
        .limit(500);

      for (const v of verified) {
        if (!v.isNew) continue;
        for (const probe of [v.hash, v.mirrorHash]) {
          if (!probe) continue;
          for (const candidate of candidates) {
            for (const candidateHash of candidate.aiAnalysis?.imageHashes || []) {
              const distance = hammingDistance(probe, candidateHash);
              if (distance <= DUPLICATE_HASH_THRESHOLD) {
                const similarityPct = Math.round((1 - distance / 64) * 100);
                throw new AppError(
                  `Duplicate image detected (~${similarityPct}% similar to existing listing "${candidate.title}"). This image is already used in another listing.`,
                  409,
                  'DUPLICATE_IMAGE'
                );
              }
            }
          }
        }
      }
    } catch (err) {
      // Verification failed — nothing was persisted. Clean up the newly
      // uploaded Cloudinary assets that belong to this rejected update.
      await cleanupUnreferencedImages(newPublicIds, product._id);
      throw err;
    }

    // Verification passed — apply the new image set with fresh hashes
    product.images = verified.map((v, idx) => ({
      url: v.img.url,
      publicId: v.img.publicId,
      isPrimary: idx === 0,
      perceptualHash: v.hash,
    }));
    if (!product.aiAnalysis) product.aiAnalysis = {};
    product.aiAnalysis.imageHashes = verified.flatMap((v) =>
      [v.hash, v.mirrorHash].filter(Boolean)
    );
    product.aiAnalysis.lastAnalyzedAt = new Date();

    await product.save();

    // Queue the full AI analysis re-run through the existing worker pipeline
    await imageProcessingQueue.add('analyze-product', {
      productId: product._id.toString(),
      images: verified.map((v) => ({
        url: v.img.url,
        publicId: v.img.publicId,
        hash: v.hash,
      })),
      productData: {
        title: product.title,
        description: product.description,
        price: product.price,
        originalPrice: product.originalPrice,
        category: product.category,
        brand: product.brand,
        model: product.model,
        condition: product.condition,
        yearsUsed: product.yearsUsed,
        specifications: product.specifications || [],
        location: product.location || {},
      },
    });

    // Recalculate the fraud/risk score with the verified hashes
    // (existing detectRisk service — same as listing creation)
    const risk = await detectRisk({
      product,
      hashes: product.aiAnalysis.imageHashes,
      aiAnalysis: product.aiAnalysis,
    });
    product.aiAnalysis.riskAssessment = {
      riskScore: risk.riskScore,
      riskLevel: risk.riskLevel,
      factors: risk.factors,
      assessedAt: new Date(),
    };
    await product.save();

    const populated = await Product.findById(product._id)
      .populate('category', 'name slug')
      .populate('seller', 'name avatar');

    res.json({ success: true, product: populated });
  } catch (err) {
    next(err);
  }
};

const deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

    if (
      product.seller.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin'
    ) {
      throw new AppError('Not authorized to delete this listing', 403, 'FORBIDDEN');
    }

    // Delete images from Cloudinary — only assets not still referenced
    // by another listing; shared assets are never destroyed.
    await cleanupUnreferencedImages(
      product.images.map((img) => img.publicId).filter(Boolean),
      product._id
    );

    product.status = 'removed';
    await product.save();

    res.json({ success: true, message: 'Product removed' });
  } catch (err) {
    next(err);
  }
};

const markAsSold = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');
    if (product.seller.toString() !== req.user._id.toString()) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }
    product.status = product.status === 'sold' ? 'active' : 'sold';
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    next(err);
  }
};

const getMyProducts = async (req, res, next) => {
  try {
    const status = req.query.status;
    const filter = { seller: req.user._id };
    if (status) filter.status = status;
    else filter.status = { $ne: 'removed' };

    const items = await Product.find(filter)
      .populate('category', 'name slug')
      .sort({ createdAt: -1 });

    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
};

const getBrands = async (req, res, next) => {
  try {
    const brands = await Product.distinct('brand', { brand: { $ne: '' }, status: 'active' });
    res.json({ success: true, brands: brands.filter(Boolean).sort() });
  } catch (err) {
    next(err);
  }
};

const getSimilarProducts = async (req, res, next) => {
  try {
    const items = await findSimilar(req.params.id, 8);
    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
};

/**
 * Product reviews + a server-side eligibility hint for the requesting
 * user. The eligibility check is advisory for UI purposes only — review
 * creation always re-verifies the qualifying purchase server-side.
 */
const getProductReviews = async (req, res, next) => {
  try {
    const productId = req.params.id;

    const product = await Product.findById(productId);
    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

    const reviews = await Review.find({ product: productId })
      .populate('buyer', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(50);

    const count = reviews.length;
    const average =
      count > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;

    let canReview = { allowed: false, reason: 'login_required' };
    if (req.user) {
      if (product.seller.toString() === req.user._id.toString()) {
        canReview = { allowed: false, reason: 'own_listing' };
      } else {
        const qualifyingSale = await Sale.findOne({
          buyer: req.user._id,
          product: productId,
          status: { $in: REVIEWABLE_STATUSES },
        });
        if (!qualifyingSale) {
          canReview = { allowed: false, reason: 'purchase_required' };
        } else if (await Review.exists({ sale: qualifyingSale._id })) {
          canReview = { allowed: false, reason: 'already_reviewed' };
        } else {
          canReview = { allowed: true };
        }
      }
    }

    res.json({
      success: true,
      reviews,
      summary: { count, average: Number(average.toFixed(2)) },
      canReview,
    });
  } catch (err) {
    next(err);
  }
};

const suggestPrice = async (req, res, next) => {
  try {
    const { category, condition, brand, originalPrice, yearsUsed } = req.query;

    // Build comparable listings query — active + sold in the same category
    const comparableFilter = { status: { $in: ['active', 'sold'] } };
    if (category) comparableFilter.category = category;

    const comparables = await Product.find(comparableFilter)
      .select('price condition brand originalPrice yearsUsed createdAt')
      .sort({ createdAt: -1 })
      .limit(100);

    const result = await calculateRecommendedPrice({
      category,
      brand: brand || undefined,
      originalPrice: Number(originalPrice) || 0,
      yearsUsed: Number(yearsUsed) || 0,
      condition: condition || 'good',
      comparableListings: comparables,
    });

    res.json({
      success: true,
      suggestedPrice: result.recommendedPrice,
      priceRange: { min: result.minPrice, max: result.maxPrice },
      confidence: result.confidence,
      comparableCount: comparables.length,
      explanation: result.explanation,
      factors: result.factors,
      source: result.source,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProducts,
  getProduct,
  uploadImages,
  createProduct,
  updateProduct,
  deleteProduct,
  markAsSold,
  getMyProducts,
  getBrands,
  getSimilarProducts,
  getProductReviews,
  suggestPrice,
};
