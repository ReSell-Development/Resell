import { useCurrency } from '../contexts/CurrencyContext';
import { convertPrice, formatCurrency } from '../utils/currency';

/**
 * Single source of truth for price display throughout the app.
 * Returns a formatter that converts a canonical backend price
 * (USD by default) into the user's selected currency using the
 * live rates from GET /api/exchange-rates/rates, then formats it.
 */
export default function useFormatPrice(fromCurrency = 'USD') {
  const { currency, rates } = useCurrency();
  return (amount) => {
    if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
    const src = fromCurrency || 'USD';
    const target = currency || 'USD';
    const converted = convertPrice(amount, src, target, rates || {});
    return rates ? formatCurrency(converted, target) : formatCurrency(amount, src);
  };
}
