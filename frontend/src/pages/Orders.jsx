import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Package, ChevronRight, Clock, CheckCircle, Truck, XCircle } from 'lucide-react';
import { orderService } from '../services/services';
import { formatPrice, formatDate } from '../utils/format';
import PageTransition from '../components/layout/PageTransition';
import Loader from '../components/ui/Loader';

const STATUS_CONFIG = {
  pending_payment: { label: 'Awaiting Payment', icon: Clock, color: 'text-amber-500' },
  paid: { label: 'Paid', icon: CheckCircle, color: 'text-blue-500' },
  shipped: { label: 'Shipped', icon: Truck, color: 'text-purple-500' },
  delivered: { label: 'Delivered', icon: Package, color: 'text-emerald-500' },
  completed: { label: 'Completed', icon: CheckCircle, color: 'text-emerald-600' },
  payment_failed: { label: 'Payment Failed', icon: XCircle, color: 'text-red-500' },
  cancelled: { label: 'Cancelled', icon: XCircle, color: 'text-slate-400' },
  refunded: { label: 'Refunded', icon: XCircle, color: 'text-orange-500' },
};

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    orderService.myOrders().then((r) => {
      setOrders(r.data.orders || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  return (
    <PageTransition>
      <div className="container-page py-8 max-w-3xl mx-auto">
        <h1 className="font-display text-2xl font-bold mb-6">My Orders</h1>

        {orders.length === 0 ? (
          <div className="text-center py-16">
            <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">No orders yet</p>
            <Link to="/marketplace" className="btn-primary mt-4 inline-flex">
              Browse Items
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending_payment;
              const Icon = cfg.icon;
              return (
                <motion.div
                  key={order._id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="card p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-4">
                    {order.product?.images?.[0] && (
                      <img src={order.product.images[0].url} alt="" className="w-16 h-16 rounded-lg object-cover" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{order.product?.title}</p>
                      <p className="text-sm text-slate-500">Seller: {order.seller?.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                        <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                        <span className="text-xs text-slate-400">· {formatDate(order.createdAt)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatPrice(order.salePrice)}</p>
                      <Link to={`/orders/${order._id}`} className="text-xs text-brand-600 hover:underline flex items-center gap-1 mt-1">
                        Details <ChevronRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
