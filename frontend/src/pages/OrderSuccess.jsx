import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, ArrowRight, Package } from 'lucide-react';
import { orderService } from '../services/services';
import PageTransition from '../components/layout/PageTransition';

export default function OrderSuccess() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    // Poll for the order — webhook may land after redirect
    const poll = setInterval(async () => {
      try {
        const { data } = await orderService.myOrders({ limit: 1 });
        const latest = data.orders?.[0];
        if (latest && latest.stripeSessionId === sessionId && latest.status !== 'pending_payment') {
          setOrder(latest);
          setLoading(false);
          clearInterval(poll);
        }
      } catch {
        // ignore — user may not be logged in yet
      }
    }, 2000);

    // Stop polling after 30s
    const timeout = setTimeout(() => { clearInterval(poll); setLoading(false); }, 30000);

    return () => { clearInterval(poll); clearTimeout(timeout); };
  }, [sessionId]);

  return (
    <PageTransition>
      <div className="container-page py-16 max-w-lg mx-auto text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          className="mb-6"
        >
          <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto" />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h1 className="font-display text-3xl font-bold mb-3">Payment Successful!</h1>
          <p className="text-slate-500 mb-8">
            Your order has been placed and payment confirmed. The seller will ship your item soon.
          </p>

          {order && (
            <div className="card p-4 mb-6 text-left">
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-brand-500" />
                <div>
                  <p className="text-sm font-medium">Order #{order._id?.slice(-8).toUpperCase()}</p>
                  <p className="text-xs text-slate-500">Status: {order.status?.replace('_', ' ')}</p>
                </div>
              </div>
            </div>
          )}

          {loading && !order && (
            <p className="text-sm text-slate-400 mb-6">Waiting for payment confirmation...</p>
          )}

          <div className="flex gap-3 justify-center">
            <Link to="/my-products" className="btn-secondary">
              My Orders
            </Link>
            <Link to="/marketplace" className="btn-primary flex items-center gap-2">
              Continue Shopping <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </motion.div>
      </div>
    </PageTransition>
  );
}
