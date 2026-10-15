import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home } from 'lucide-react';
import PageTransition from '../components/layout/PageTransition';

export default function NotFound() {
  return (
    <PageTransition>
      <div className="container-page py-32 text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-brand-100 to-accent-100 mb-6"
        >
          <span className="text-4xl font-display font-extrabold gradient-text">404</span>
        </motion.div>
        <h1 className="font-display font-bold text-3xl mb-2">Page not found</h1>
        <p className="text-slate-500 mb-6">The page you're looking for doesn't exist.</p>
        <Link to="/" className="btn-primary">
          <Home className="w-4 h-4" />
          Back Home
        </Link>
      </div>
    </PageTransition>
  );
}
