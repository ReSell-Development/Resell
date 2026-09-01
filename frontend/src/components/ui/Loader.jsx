import { motion } from 'framer-motion';

export default function Loader({ size = 'md', fullScreen = false }) {
  const sizes = {
    sm: 'h-6 w-6 border-2',
    md: 'h-10 w-10 border-3',
    lg: 'h-16 w-16 border-4',
  };
  const content = (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
      className={`${sizes[size]} rounded-full border-slate-200 border-t-brand-600`}
    />
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-white/80 backdrop-blur-sm z-50">
        {content}
      </div>
    );
  }
  return <div className="flex items-center justify-center p-8">{content}</div>;
}
