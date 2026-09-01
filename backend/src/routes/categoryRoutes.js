const express = require('express');
const router = express.Router();
const {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryStats,
} = require('../controllers/categoryController');
const { protect, authorize } = require('../middleware/auth');
const {
  createCategoryValidation,
  updateCategoryValidation,
} = require('../middleware/validate');

router.get('/', getCategories);
router.get('/stats', getCategoryStats);
router.get('/:slug', getCategory);
router.post('/', protect, authorize('admin'), createCategoryValidation, createCategory);
router.put('/:id', protect, authorize('admin'), updateCategoryValidation, updateCategory);
router.delete('/:id', protect, authorize('admin'), deleteCategory);

module.exports = router;
