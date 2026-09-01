const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getAllUsers,
  updateUser,
  deleteUser,
  getAllProducts,
  moderateProduct,
  getAnalytics,
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');
const {
  updateUserValidation,
  moderateProductValidation,
} = require('../middleware/validate');

router.use(protect, authorize('admin'));

router.get('/stats', getDashboardStats);
router.get('/analytics', getAnalytics);

router.get('/users', getAllUsers);
router.put('/users/:id', updateUserValidation, updateUser);
router.delete('/users/:id', deleteUser);

router.get('/products', getAllProducts);
router.put('/products/:id', moderateProductValidation, moderateProduct);

module.exports = router;
