/**
 * Listings Routes - Duplicate Detection & Product Management
 */

const express = require('express');
const router = express.Router();
const {
  checkDuplicate,
  uploadImages,
  createListing,
  getListing,
  searchListings,
  reportListing,
  getDuplicateStats,
} = require('../controllers/duplicateController');
const { protect, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { productCreateLimiter } = require('../middleware/rateLimiters');
const {
  createProductValidation,
  productQueryValidation,
} = require('../middleware/validate');

// Duplicate check endpoint (before upload)
router.post(
  '/check-duplicate',
  protect,
  upload.single('image'),
  checkDuplicate
);

// Upload images with duplicate detection
router.post(
  '/upload-images',
  protect,
  upload.array('images', 8),
  uploadImages
);

// Create listing (final validation + creation)
router.post(
  '/',
  protect,
  productCreateLimiter,
  createProductValidation,
  createListing
);

// Search listings (excludes duplicates)
router.get(
  '/search',
  optionalAuth,
  productQueryValidation,
  searchListings
);

// Get single listing
router.get(
  '/:id',
  optionalAuth,
  getListing
);

// Report listing
router.post(
  '/:id/report',
  protect,
  reportListing
);

// Admin: duplicate statistics
router.get(
  '/admin/duplicate-stats',
  protect,
  (req, res, next) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
  },
  getDuplicateStats
);

module.exports = router;