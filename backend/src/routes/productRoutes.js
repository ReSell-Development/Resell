const express = require('express');
const router = express.Router();
const {
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
  suggestPrice,
  getProductIdentityStatus,
  submitPossessionVerification,
} = require('../controllers/productController');
const { protect, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { productCreateLimiter } = require('../middleware/rateLimiters');
const {
  createProductValidation,
  updateProductValidation,
  productQueryValidation,
  verifyPossessionValidation,
} = require('../middleware/validate');

router.get('/', optionalAuth, productQueryValidation, getProducts);
router.get('/suggest-price', optionalAuth, suggestPrice);
router.get('/brands', getBrands);
router.get('/mine', protect, getMyProducts);
router.get('/:id', optionalAuth, getProduct);
router.get('/:id/similar', optionalAuth, getSimilarProducts);
router.get('/:id/identity', optionalAuth, getProductIdentityStatus);
router.post(
  '/:id/identity/verify-possession',
  protect,
  verifyPossessionValidation,
  submitPossessionVerification
);

router.post(
  '/upload-images',
  protect,
  upload.array('images', 8),
  uploadImages
);
router.post('/', protect, productCreateLimiter, createProductValidation, createProduct);
router.put('/:id', protect, updateProductValidation, updateProduct);
router.delete('/:id', protect, deleteProduct);
router.patch('/:id/sold', protect, markAsSold);

module.exports = router;
