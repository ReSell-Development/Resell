const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const { perceptualHashFromBuffer } = require('../services/imageHash');
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

const uploadImages = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      throw new AppError('No images provided', 400, 'NO_FILES');
    }

    const results = [];
    for (const file of req.files) {
      try {
        const uploaded = await uploadToCloudinary(file.buffer, 'resell/products');
        const hash = await perceptualHashFromBuffer(file.buffer);

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
        // Still include the upload with minimal info
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
    if (req.body.images && Array.isArray(req.body.images) && req.body.images.length > 0) {
      product.images = req.body.images.map((img, idx) => ({
        url: img.url,
        publicId: img.publicId,
        isPrimary: idx === 0,
      }));
    }
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

    // Delete images from Cloudinary
    for (const img of product.images) {
      if (img.publicId) await deleteFromCloudinary(img.publicId);
    }

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
};
