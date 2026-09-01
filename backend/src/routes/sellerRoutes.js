const express = require('express');
const router = express.Router();
const {
  getSellerProfile,
  getSellerTrust,
  addReview,
  getSimilarProducts,
} = require('../controllers/sellerController');
const { protect, optionalAuth } = require('../middleware/auth');
const { addReviewValidation } = require('../middleware/validate');

router.get('/:id', getSellerProfile);
router.get('/:id/trust', getSellerTrust);
router.post('/:id/reviews', protect, addReviewValidation, addReview);
router.get('/:id/similar', optionalAuth, getSimilarProducts);

module.exports = router;
