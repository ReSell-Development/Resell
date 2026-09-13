const express = require('express');
const router = express.Router();
const {
  createOffer,
  listOffers,
  getMyOffers,
  getReceivedOffers,
  updateOffer,
  acceptOffer,
  rejectOffer,
  counterOffer,
} = require('../controllers/offerController');
const { protect, authorize } = require('../middleware/auth');
const { createOfferValidation, counterOfferValidation } = require('../middleware/validate');

router.use(protect);

router.post('/', createOfferValidation, createOffer);
router.get('/', authorize('admin'), listOffers);
router.get('/mine', getMyOffers);
router.get('/received', getReceivedOffers);
router.put('/:id', updateOffer);
router.post('/:id/accept', acceptOffer);
router.post('/:id/reject', rejectOffer);
router.post('/:id/counter', counterOfferValidation, counterOffer);

module.exports = router;
