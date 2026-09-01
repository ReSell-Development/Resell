const { SUPPORTED, BASE, getRates, convert } = require('../services/exchangeRates');

const getExchangeRates = async (req, res, next) => {
  try {
    const { rates, fetchedAt, source } = await getRates();
    res.json({
      success: true,
      base: BASE,
      supported: SUPPORTED,
      rates,
      fetchedAt: new Date(fetchedAt).toISOString(),
      source,
      ttlMs: 60 * 60 * 1000,
    });
  } catch (err) {
    next(err);
  }
};

const convertCurrency = async (req, res, next) => {
  try {
    const { amount, from, to } = req.body || {};
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'amount must be a non-negative number' });
    }
    if (!from || !to) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'from and to are required' });
    }
    const { rates } = await getRates();
    const converted = convert(value, String(from).toUpperCase(), String(to).toUpperCase(), rates);
    res.json({ success: true, amount: value, from: String(from).toUpperCase(), to: String(to).toUpperCase(), converted });
  } catch (err) {
    next(err);
  }
};

module.exports = { getExchangeRates, convertCurrency };
