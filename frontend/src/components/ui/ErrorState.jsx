import { motion } from 'framer-motion';
import { AlertCircle, WifiOff } from 'lucide-react';

export default function ErrorState({
  title = 'Something went wrong',
  description = "We couldn't load this page.",
  onRetry,
  variant = 'error',
}) {
  const isNetwork = variant === 'network';
  const Icon = isNetwork ? WifiOff : AlertCircle;
  const iconWrapClass = isNetwork
    ? 'bg-amber-50'
    : 'bg-red-50';
  const iconClass = isNetwork
    ? 'text-amber-500'
    : 'text-red-500';
  const ctaLabel = isNetwork ? 'Retry' : 'Try Again';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-center py-16 px-4"
      role="alert"
    >
      <div className={`inline-flex items-center justify-center w-20 h-20 rounded-2xl ${iconWrapClass} mb-4`}>
        <Icon className={`w-10 h-10 ${iconClass}`} />
      </div>
      <h3 className="text-lg font-display font-semibold text-slate-900 mb-2">{title}</h3>
      {description && <p className="text-slate-500 max-w-sm mx-auto mb-6">{description}</p>}
      {onRetry && (
        <button onClick={onRetry} className="btn-primary">
          {ctaLabel}
        </button>
      )}
    </motion.div>
  );
}
