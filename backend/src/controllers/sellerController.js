const User = require('../models/User');
const Product = require('../models/Product');
const Review = require('../models/Review');
const Sale = require('../models/Sale');
const { REVIEWABLE_STATUSES } = require('../models/Sale');
const AppError = require('../utils/AppError');
const { calculateTrustScore } = require('../services/trustScore');
const { findSimilar } = require('../services/similarProducts');

const getSellerProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError('Seller not found', 404, 'NOT_FOUND');

    const trust = await calculateTrustScore(user._id);

    const products = await Product.find({
      seller: user._id,
      status: { $in: ['active', 'sold'] },
    })
      .populate('category', 'name slug')
      .sort({ createdAt: -1 })
      .limit(20);

    const reviews = await Review.find({ seller: user._id })
      .populate('buyer', 'name avatar')
      .populate('product', 'title')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      seller: user,
      trust,
      products,
      reviews,
    });
  } catch (err) {
    next(err);
  }
};

const getSellerTrust = async (req, res, next) => {
  try {
    const trust = await calculateTrustScore(req.params.id);
    res.json({ success: true, trust });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a review.
 *
 * Verified-purchase gating: a review is only allowed for a genuine,
 * completed purchase. Everything is verified server-side:
 *   - the authenticated user must be the buyer of a qualifying Sale
 *     (delivered/completed) from this seller
 *   - the product being reviewed (if any) must be the product of that Sale
 *   - the review is tied to the qualifying Sale, so the same purchase
 *     cannot be reviewed twice
 * Client-supplied buyer/sale identifiers are never trusted; the buyer is
 * always req.user and the Sale is looked up from the DB.
 */
const addReview = async (req, res, next) => {
  try {
    const { rating, comment, product } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      throw new AppError('Rating must be between 1 and 5', 400, 'VALIDATION_ERROR');
    }
    const seller = await User.findById(req.params.id);
    if (!seller) throw new AppError('Seller not found', 404, 'NOT_FOUND');
    if (seller._id.toString() === req.user._id.toString()) {
      throw new AppError('Cannot review yourself', 400, 'INVALID');
    }

    // Locate a qualifying purchase for the authenticated user.
    // When a product is being reviewed, the Sale must be for that product.
    const saleFilter = {
      buyer: req.user._id,
      seller: seller._id,
      status: { $in: REVIEWABLE_STATUSES },
    };
    if (product) saleFilter.product = product;

    const qualifyingSale = await Sale.findOne(saleFilter);
    if (!qualifyingSale) {
      throw new AppError(
        'You can only review after a completed purchase from this seller',
        403,
        'PURCHASE_REQUIRED'
      );
    }

    // One review per qualifying transaction
    const existing = await Review.findOne({ sale: qualifyingSale._id });
    if (existing) {
      throw new AppError('You have already reviewed this purchase', 409, 'REVIEW_EXISTS');
    }

    const review = await Review.create({
      seller: seller._id,
      buyer: req.user._id,
      product: qualifyingSale.product,
      sale: qualifyingSale._id,
      rating,
      comment: comment || '',
    });
    res.status(201).json({ success: true, review });
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
  getSellerProfile,
  getSellerTrust,
  addReview,
  getSimilarProducts,
};
