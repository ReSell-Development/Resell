const SUPPORTED = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'SGD', 'AED', 'MXN', 'BRL', 'ZAR', 'NZD', 'SEK', 'NOK', 'DKR', 'HKD', 'KRW'];

const SUPPORTED_SET = new Set(SUPPORTED);
const BASE = 'USD';
const TTL_MS = 60 * 60 * 1000;

const EXCHANGERATE_API = `https://open.er-api.com/v6/latest/${BASE}`;
const EXCHANGERATE_HOST = `https://api.exchangerate.host/latest?base=${BASE}`;

let cache = { rates: null, fetchedAt: 0, source: null };

const fallbackRates = () => {
  const usd = 1;
  return {
    USD: usd, EUR: 0.92, GBP: 0.79, INR: 83.2, JPY: 151.4, CAD: 1.36, AUD: 1.52,
    CHF: 0.88, CNY: 7.24, SGD: 1.34, AED: 3.67, MXN: 17.05, BRL: 5.05, ZAR: 18.6,
    NZD: 1.64, SEK: 10.55, NOK: 10.7, DKR: 6.87, HKD: 7.82, KRW: 1360,
  };
};

const isFresh = () => cache.rates && Date.now() - cache.fetchedAt < TTL_MS;

const fetchWithTimeout = async (url, ms = 6000) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    return res;
  } finally {
    clearTimeout(t);
  }
};

const refresh = async () => {
  for (const url of [EXCHANGERATE_API, EXCHANGERATE_HOST]) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const data = await res.json();
      const rates = data.rates || data.conversion_rates;
      if (!rates || typeof rates !== 'object') continue;
      cache = { rates, fetchedAt: Date.now(), source: url };
      return cache;
    } catch {
      /* try next provider */
    }
  }
  return null;
};

const getRates = async () => {
  if (isFresh()) return cache;
  const refreshed = await refresh();
  if (refreshed) return refreshed;
  if (!cache.rates) {
    cache = { rates: fallbackRates(), fetchedAt: Date.now(), source: 'fallback' };
  }
  return cache;
};

const startScheduler = () => {
  const intervalMs = TTL_MS;
  const tick = async () => {
    try {
      await refresh();
    } catch {
      /* swallow; keep cache */
    }
  };
  tick();
  setInterval(tick, intervalMs).unref?.();
};

const convert = (amount, from, to, rates) => {
  if (!amount || amount <= 0) return amount;
  if (from === to) return amount;
  const safeFrom = SUPPORTED_SET.has(from) ? from : BASE;
  const safeTo = SUPPORTED_SET.has(to) ? to : BASE;
  const rFrom = rates[safeFrom];
  const rTo = rates[safeTo];
  if (!rFrom || !rTo) return amount;
  const inUsd = amount / rFrom;
  return inUsd * rTo;
};

module.exports = { SUPPORTED, BASE, getRates, refresh, startScheduler, convert };
