const User = require('../models/User');
const Product = require('../models/Product');
const Review = require('../models/Review');
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

    const existing = await Review.findOne({
      seller: seller._id,
      buyer: req.user._id,
    });
    if (existing) {
      existing.rating = rating;
      existing.comment = comment || '';
      await existing.save();
      return res.json({ success: true, review: existing });
    }

    const review = await Review.create({
      seller: seller._id,
      buyer: req.user._id,
      product: product || null,
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
