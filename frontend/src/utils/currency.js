export const SUPPORTED_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', symbol: '£', name: 'British Pound', flag: '🇬🇧' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', flag: '🇯🇵' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', flag: '🇨🇦' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc', flag: '🇨🇭' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', flag: '🇨🇳' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', flag: '🇸🇬' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', flag: '🇦🇪' },
  { code: 'MXN', symbol: 'Mex$', name: 'Mexican Peso', flag: '🇲🇽' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', flag: '🇧🇷' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', flag: '🇿🇦' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', flag: '🇳🇿' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona', flag: '🇸🇪' },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone', flag: '🇳🇴' },
  { code: 'DKK', symbol: 'kr', name: 'Danish Krone', flag: '🇩🇰' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', flag: '🇭🇰' },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won', flag: '🇰🇷' },
];

const SUPPORTED_SET = new Set(SUPPORTED_CURRENCIES.map((c) => c.code));

const COUNTRY_TO_CURRENCY = {
  US: 'USD', GB: 'GBP', IN: 'INR', JP: 'JPY', CA: 'CAD', AU: 'AUD', CH: 'CHF', CN: 'CNY',
  SG: 'SGD', AE: 'AED', MX: 'MXN', BR: 'BRL', ZA: 'ZAR', NZ: 'NZD', SE: 'SEK', NO: 'NOK',
  DK: 'DKK', HK: 'HKD', KR: 'KRW', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR',
  NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR',
};

const COUNTRY_KEYWORDS = [
  ['India', 'INR'], ['United States', 'USD'], ['United Kingdom', 'GBP'], ['UK', 'GBP'],
  ['Japan', 'JPY'], ['Canada', 'CAD'], ['Australia', 'AUD'], ['Germany', 'EUR'],
  ['France', 'EUR'], ['Singapore', 'SGD'], ['UAE', 'AED'], ['Mexico', 'MXN'],
  ['Brazil', 'BRL'], ['China', 'CNY'], ['Korea', 'KRW'], ['Switzerland', 'CHF'],
];

export const detectCurrencyFromLocation = (locationString) => {
  if (!locationString) return null;
  const lc = String(locationString).toLowerCase();
  for (const [kw, code] of COUNTRY_KEYWORDS) {
    if (lc.includes(kw.toLowerCase())) return code;
  }
  return null;
};

export const detectCurrencyFromLocale = () => {
  try {
    const locale = Intl.NumberFormat().resolvedOptions().locale || '';
    const region = locale.split('-')[1] || locale.split('_')[1];
    if (region && COUNTRY_TO_CURRENCY[region.toUpperCase()]) {
      return COUNTRY_TO_CURRENCY[region.toUpperCase()];
    }
  } catch {
    /* ignore */
  }
  return 'USD';
};

export const resolveCurrency = ({ saved, userLocation }) => {
  if (saved && SUPPORTED_SET.has(saved)) return saved;
  const fromLocation = detectCurrencyFromLocation(userLocation);
  if (fromLocation && SUPPORTED_SET.has(fromLocation)) return fromLocation;
  return detectCurrencyFromLocale();
};

export const formatCurrency = (amount, currencyCode) => {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: amount >= 1000 ? 0 : 2,
  }).format(amount);
};

export const convertPrice = (amount, fromCurrency, toCurrency, rates) => {
  if (amount === null || amount === undefined) return amount;
  if (!fromCurrency || !toCurrency) return amount;
  if (fromCurrency === toCurrency) return amount;
  if (!rates || !rates[fromCurrency] || !rates[toCurrency]) return amount;
  const inUsd = Number(amount) / Number(rates[fromCurrency]);
  return inUsd * Number(rates[toCurrency]);
};

export const isSupportedCurrency = (code) => SUPPORTED_SET.has(code);
