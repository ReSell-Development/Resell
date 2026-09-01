import { motion } from 'framer-motion';
import { cn, getTrustColor } from '../../utils/format';

export default function TrustBadge({ score, level, size = 'md', showLabel = true }) {
  if (score === undefined || score === null) return null;
  const sizes = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5',
  };

  return (
    <div className="inline-flex items-center gap-2">
      {showLabel && (
        <span className="text-xs text-slate-500 font-medium">Trust</span>
      )}
      <div className="relative">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className={cn(
            'h-2 rounded-full bg-gradient-to-r',
            getTrustColor(score)
          )}
        />
        <div className="absolute inset-0 h-2 rounded-full bg-slate-100 -z-10" />
      </div>
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className={cn(
          'font-bold rounded-full bg-gradient-to-r text-white',
          getTrustColor(score),
          sizes[size]
        )}
      >
        {score}
      </motion.span>
    </div>
  );
}
