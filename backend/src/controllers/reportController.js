const Report = require('../models/Report');
const Product = require('../models/Product');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const audit = require('../middleware/audit');

const createReport = async (req, res, next) => {
  try {
    const { targetType, target, reason, description } = req.body;
    if (!targetType || !target || !reason) {
      throw new AppError('Target type, target and reason are required', 400, 'VALIDATION_ERROR');
    }

    if (!['product', 'user'].includes(targetType)) {
      throw new AppError('Invalid target type', 400, 'VALIDATION_ERROR');
    }

    if (targetType === 'product') {
      const exists = await Product.findById(target);
      if (!exists) throw new AppError('Product not found', 404, 'NOT_FOUND');
    } else {
      const exists = await User.findById(target);
      if (!exists) throw new AppError('User not found', 404, 'NOT_FOUND');
    }

    const existing = await Report.findOne({
      reporter: req.user._id,
      target,
      targetType,
    });
    if (existing) {
      return res.json({ success: true, message: 'You have already reported this' });
    }

    const report = await Report.create({
      reporter: req.user._id,
      targetType,
      target,
      reason,
      description: description || '',
    });

    if (targetType === 'product') {
      const reportCount = await Report.countDocuments({ target, targetType: 'product' });
      if (reportCount >= 3) {
        await Product.updateOne({ _id: target }, { $set: { isFlagged: true, flagReason: 'multiple reports' } });
      }
    }

    res.status(201).json({ success: true, report });
  } catch (err) {
    next(err);
  }
};

const getReports = async (req, res, next) => {
  try {
    const status = req.query.status;
    const filter = {};
    if (status) filter.status = status;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Report.find(filter)
        .populate('reporter', 'name email')
        .populate('reviewedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Report.countDocuments(filter),
    ]);

    // Populate target based on targetType
    await Promise.all(
      items.map(async (r) => {
        if (r.targetType === 'product') {
          await r.populate('target', 'title images status');
        } else {
          await r.populate('target', 'name email');
        }
      })
    );

    res.json({
      success: true,
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

const updateReport = async (req, res, next) => {
  try {
    const { status, action } = req.body;
    const report = await Report.findById(req.params.id);
    if (!report) throw new AppError('Report not found', 404, 'NOT_FOUND');

    if (status) report.status = status;
    if (action !== undefined) report.action = action;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();
    await report.save();

    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
};

module.exports = { createReport, getReports, updateReport };
