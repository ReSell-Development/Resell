const Favorite = require('../models/Favorite');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');

const addFavorite = async (req, res, next) => {
  try {
    const productId = req.params.productId;
    const product = await Product.findById(productId);
    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');

    const existing = await Favorite.findOne({ user: req.user._id, product: productId });
    if (existing) {
      return res.json({ success: true, favorited: true, message: 'Already favorited' });
    }

    await Favorite.create({ user: req.user._id, product: productId });
    await Product.updateOne({ _id: productId }, { $inc: { favoritesCount: 1 } });

    res.json({ success: true, favorited: true });
  } catch (err) {
    next(err);
  }
};

const removeFavorite = async (req, res, next) => {
  try {
    const productId = req.params.productId;
    const result = await Favorite.findOneAndDelete({
      user: req.user._id,
      product: productId,
    });
    if (result) {
      await Product.updateOne({ _id: productId }, { $inc: { favoritesCount: -1 } });
    }
    res.json({ success: true, favorited: false });
  } catch (err) {
    next(err);
  }
};

const getFavorites = async (req, res, next) => {
  try {
    const favorites = await Favorite.find({ user: req.user._id })
      .populate({
        path: 'product',
        populate: { path: 'category seller', select: 'name slug avatar' },
      })
      .sort({ createdAt: -1 });

    const items = favorites
      .map((f) => f.product)
      .filter((p) => p && p.status !== 'removed');

    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
};

const checkFavorite = async (req, res, next) => {
  try {
    if (!req.user) return res.json({ success: true, favorited: false });
    const fav = await Favorite.findOne({
      user: req.user._id,
      product: req.params.productId,
    });
    res.json({ success: true, favorited: !!fav });
  } catch (err) {
    next(err);
  }
};

module.exports = { addFavorite, removeFavorite, getFavorites, checkFavorite };
