const express = require('express');
const router = express.Router();
const { getExchangeRates, convertCurrency } = require('../controllers/exchangeController');

router.get('/rates', getExchangeRates);
router.post('/convert', convertCurrency);

module.exports = router;
