import { motion } from 'framer-motion';
import { X, AlertCircle } from 'lucide-react';

export default function ErrorState({ title = 'Something went wrong', description, onRetry }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-center py-16 px-4"
    >
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-red-50 mb-4">
        <AlertCircle className="w-10 h-10 text-red-500" />
      </div>
      <h3 className="text-lg font-display font-semibold text-slate-900 mb-2">{title}</h3>
      {description && <p className="text-slate-500 max-w-sm mx-auto mb-6">{description}</p>}
      {onRetry && (
        <button onClick={onRetry} className="btn-primary">
          Try Again
        </button>
      )}
    </motion.div>
  );
}
