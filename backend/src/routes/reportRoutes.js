const express = require('express');
const router = express.Router();
const {
  createReport,
  getReports,
  updateReport,
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');
const {
  createReportValidation,
  updateReportValidation,
} = require('../middleware/validate');

router.post('/', protect, createReportValidation, createReport);
router.get('/', protect, authorize('admin'), getReports);
router.put('/:id', protect, authorize('admin'), updateReportValidation, updateReport);

module.exports = router;
