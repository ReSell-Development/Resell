import { useCurrency } from '../../contexts/CurrencyContext';
import { convertPrice, formatCurrency } from '../../utils/currency';
import { cn } from '../../utils/format';

export default function Price({
  amount,
  originalPrice = 0,
  fromCurrency = 'USD',
  className = '',
  size = 'md',
  showOriginal = true,
}) {
  const { currency, rates } = useCurrency();
  const src = fromCurrency || 'USD';
  const target = currency || 'USD';

  const converted = convertPrice(amount, src, target, rates || {});
  const formatted = rates ? formatCurrency(converted, target) : formatCurrency(amount, src);

  const formattedOriginal = originalPrice > 0 && rates
    ? formatCurrency(convertPrice(originalPrice, src, target, rates), target)
    : formatCurrency(originalPrice, src);

  const showSecondary = showOriginal && src !== target && rates;

  const sizeClass =
    size === 'lg'
      ? 'text-4xl'
      : size === 'sm'
        ? 'text-base'
        : 'text-xl';

  return (
    <div className={cn('flex flex-wrap items-baseline gap-2', className)}>
      <span className={cn('font-display font-bold text-slate-900', sizeClass)}>{formatted}</span>
      {originalPrice > amount && (
        <span className="text-sm text-slate-400 line-through">{formattedOriginal}</span>
      )}
      {showSecondary && (
        <span className="text-xs text-slate-500">
          (Listed {formatCurrency(amount, src)})
        </span>
      )}
    </div>
  );
}
