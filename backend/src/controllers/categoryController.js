const Category = require('../models/Category');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const { buildSlug } = require('../utils/slug');

const getCategories = async (req, res, next) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ name: 1 });
    res.json({ success: true, categories });
  } catch (err) {
    next(err);
  }
};

const getCategory = async (req, res, next) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug });
    if (!category) throw new AppError('Category not found', 404, 'NOT_FOUND');
    res.json({ success: true, category });
  } catch (err) {
    next(err);
  }
};

const createCategory = async (req, res, next) => {
  try {
    const { name, description, icon, image, parent } = req.body;
    if (!name) throw new AppError('Name is required', 400, 'VALIDATION_ERROR');

    const slug = buildSlug(name);
    const existing = await Category.findOne({ slug });
    if (existing) throw new AppError('Category already exists', 400, 'DUPLICATE');

    const category = await Category.create({
      name,
      slug,
      description: description || '',
      icon: icon || 'package',
      image: image || '',
      parent: parent || null,
    });

    res.status(201).json({ success: true, category });
  } catch (err) {
    next(err);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const updates = {};
    ['name', 'description', 'icon', 'image', 'parent', 'isActive'].forEach((k) => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    if (updates.name) updates.slug = buildSlug(updates.name);
    const category = await Category.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!category) throw new AppError('Category not found', 404, 'NOT_FOUND');
    res.json({ success: true, category });
  } catch (err) {
    next(err);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const inUse = await Product.countDocuments({ category: req.params.id });
    if (inUse > 0) {
      throw new AppError(
        `Cannot delete category with ${inUse} active listings`,
        400,
        'CATEGORY_IN_USE'
      );
    }
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) throw new AppError('Category not found', 404, 'NOT_FOUND');
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    next(err);
  }
};

const getCategoryStats = async (req, res, next) => {
  try {
    const stats = await Product.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: '$category' },
      {
        $project: {
          count: 1,
          name: '$category.name',
          slug: '$category.slug',
          icon: '$category.icon',
        },
      },
      { $sort: { count: -1 } },
    ]);
    res.json({ success: true, stats });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryStats,
};
