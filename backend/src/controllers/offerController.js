const Offer = require('../models/Offer');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');

const createOffer = async (req, res, next) => {
  try {
    const { productId, amount, message, currencyCode } = req.body;

    const product = await Product.findById(productId);
    if (!product) throw new AppError('Product not found', 404, 'NOT_FOUND');
    if (product.status !== 'active') throw new AppError('Product is not available', 400, 'PRODUCT_UNAVAILABLE');
    if (product.seller.toString() === req.user._id.toString()) {
      throw new AppError('Cannot make an offer on your own product', 400, 'INVALID_OFFER');
    }

    const offer = await Offer.create({
      product: productId,
      buyer: req.user._id,
      seller: product.seller,
      amount,
      message: message || '',
      currencyCode: currencyCode || 'USD',
      history: [{ status: 'pending', actor: req.user._id, at: new Date() }],
    });

    const populated = await Offer.findById(offer._id)
      .populate('product', 'title images price')
      .populate('buyer', 'name avatar')
      .populate('seller', 'name avatar');

    res.status(201).json({ success: true, offer: populated });
  } catch (err) {
    next(err);
  }
};

const listOffers = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [offers, total] = await Promise.all([
      Offer.find()
        .populate('product', 'title images price')
        .populate('buyer', 'name avatar')
        .populate('seller', 'name avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Offer.countDocuments(),
    ]);

    res.json({ success: true, offers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};

const getMyOffers = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [offers, total] = await Promise.all([
      Offer.find({ buyer: req.user._id })
        .populate('product', 'title images price status')
        .populate('seller', 'name avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Offer.countDocuments({ buyer: req.user._id }),
    ]);

    res.json({ success: true, offers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};

const getReceivedOffers = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [offers, total] = await Promise.all([
      Offer.find({ seller: req.user._id })
        .populate('product', 'title images price status')
        .populate('buyer', 'name avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Offer.countDocuments({ seller: req.user._id }),
    ]);

    res.json({ success: true, offers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};

const updateOffer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, message } = req.body;

    const offer = await Offer.findById(id);
    if (!offer) throw new AppError('Offer not found', 404, 'NOT_FOUND');

    if (!offer.canTransition(status)) {
      throw new AppError(`Cannot transition from ${offer.status} to ${status}`, 400, 'INVALID_TRANSITION');
    }

    offer.status = status;
    offer.history.push({ status, actor: req.user._id, at: new Date(), note: message || '' });
    await offer.save();

    const populated = await Offer.findById(offer._id)
      .populate('product', 'title images price')
      .populate('buyer', 'name avatar')
      .populate('seller', 'name avatar');

    res.json({ success: true, offer: populated });
  } catch (err) {
    next(err);
  }
};

const acceptOffer = async (req, res, next) => {
  try {
    const { id } = req.params;

    const offer = await Offer.findOneAndUpdate(
      { _id: id, seller: req.user._id, status: 'pending' },
      {
        $set: { status: 'accepted' },
        $push: { history: { status: 'accepted', actor: req.user._id, at: new Date() } },
      },
      { new: true }
    );

    if (!offer) throw new AppError('Offer not found or already processed', 404, 'NOT_FOUND');

    const populated = await Offer.findById(offer._id)
      .populate('product', 'title images price')
      .populate('buyer', 'name avatar')
      .populate('seller', 'name avatar');

    res.json({ success: true, offer: populated });
  } catch (err) {
    next(err);
  }
};

const rejectOffer = async (req, res, next) => {
  try {
    const { id } = req.params;

    const offer = await Offer.findOneAndUpdate(
      { _id: id, seller: req.user._id, status: 'pending' },
      {
        $set: { status: 'rejected' },
        $push: { history: { status: 'rejected', actor: req.user._id, at: new Date() } },
      },
      { new: true }
    );

    if (!offer) throw new AppError('Offer not found or already processed', 404, 'NOT_FOUND');

    const populated = await Offer.findById(offer._id)
      .populate('product', 'title images price')
      .populate('buyer', 'name avatar')
      .populate('seller', 'name avatar');

    res.json({ success: true, offer: populated });
  } catch (err) {
    next(err);
  }
};

const counterOffer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, message } = req.body;

    const original = await Offer.findById(id);
    if (!original) throw new AppError('Offer not found', 404, 'NOT_FOUND');
    if (!original.canTransition('countered')) {
      throw new AppError(`Cannot counter offer in ${original.status} status`, 400, 'INVALID_TRANSITION');
    }

    original.status = 'countered';
    original.history.push({ status: 'countered', actor: req.user._id, at: new Date(), note: message || '' });
    await original.save();

    const newOffer = await Offer.create({
      product: original.product,
      buyer: original.buyer,
      seller: original.seller,
      amount,
      message: message || '',
      currencyCode: original.currencyCode,
      parentOffer: original._id,
      history: [{ status: 'pending', actor: req.user._id, at: new Date() }],
    });

    const populated = await Offer.findById(newOffer._id)
      .populate('product', 'title images price')
      .populate('buyer', 'name avatar')
      .populate('seller', 'name avatar');

    res.status(201).json({ success: true, offer: populated });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createOffer,
  listOffers,
  getMyOffers,
  getReceivedOffers,
  updateOffer,
  acceptOffer,
  rejectOffer,
  counterOffer,
};
