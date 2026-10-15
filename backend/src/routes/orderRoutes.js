const express = require('express');
const router = express.Router();
const {
  getMyOrders,
  getMySales,
  getOrder,
  shipOrder,
  deliverOrder,
  cancelOrder,
} = require('../controllers/orderController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/mine', getMyOrders);
router.get('/selling', getMySales);
router.get('/:id', getOrder);
router.patch('/:id/ship', shipOrder);
router.patch('/:id/deliver', deliverOrder);
router.post('/:id/cancel', cancelOrder);

module.exports = router;
