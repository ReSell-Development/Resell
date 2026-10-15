const express = require('express');
const router = express.Router();
const {
  addFavorite,
  removeFavorite,
  getFavorites,
  checkFavorite,
} = require('../controllers/favoriteController');
const { protect, optionalAuth } = require('../middleware/auth');
const { favoriteValidation } = require('../middleware/validate');

router.get('/', protect, getFavorites);
router.get('/:productId/check', optionalAuth, favoriteValidation, checkFavorite);
router.post('/:productId', protect, favoriteValidation, addFavorite);
router.delete('/:productId', protect, favoriteValidation, removeFavorite);

module.exports = router;
