import { motion } from 'framer-motion';
import { Package } from 'lucide-react';

export default function EmptyState({ icon: Icon = Package, title, description, action }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-16 px-4"
    >
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
        className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-100 to-accent-100 mb-4"
      >
        <Icon className="w-10 h-10 text-brand-600" />
      </motion.div>
      <h3 className="text-lg font-display font-semibold text-slate-900 mb-2">{title}</h3>
      {description && (
        <p className="text-slate-500 max-w-sm mx-auto mb-6">{description}</p>
      )}
      {action}
    </motion.div>
  );
}
