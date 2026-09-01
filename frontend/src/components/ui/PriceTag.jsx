import { motion } from 'framer-motion';
import { formatPrice } from '../../utils/format';

export default function PriceTag({ price, originalPrice, size = 'md', className = '' }) {
  const sizes = {
    sm: 'text-base',
    md: 'text-xl',
    lg: 'text-3xl',
    xl: 'text-5xl',
  };
  const discount = originalPrice > price ? Math.round(((originalPrice - price) / originalPrice) * 100) : 0;

  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <motion.span
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className={`font-display font-bold text-slate-900 ${sizes[size]}`}
      >
        {formatPrice(price)}
      </motion.span>
      {originalPrice > price && (
        <>
          <span className="text-sm text-slate-400 line-through">{formatPrice(originalPrice)}</span>
          <span className="badge bg-accent-100 text-accent-700">-{discount}%</span>
        </>
      )}
    </div>
  );
}
