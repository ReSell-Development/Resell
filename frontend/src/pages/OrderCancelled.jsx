import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { XCircle, ArrowRight } from 'lucide-react';
import PageTransition from '../components/layout/PageTransition';

export default function OrderCancelled() {
  return (
    <PageTransition>
      <div className="container-page py-16 max-w-lg mx-auto text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          className="mb-6"
        >
          <XCircle className="w-16 h-16 text-red-400 mx-auto" />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h1 className="font-display text-3xl font-bold mb-3">Payment Cancelled</h1>
          <p className="text-slate-500 mb-8">
            Your payment was not completed. No charges were made. You can try again or browse more items.
          </p>

          <div className="flex gap-3 justify-center">
            <Link to="/marketplace" className="btn-primary flex items-center gap-2">
              Browse Items <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </motion.div>
      </div>
    </PageTransition>
  );
}
