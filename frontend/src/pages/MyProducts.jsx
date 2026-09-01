import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus,
  Edit3,
  Trash2,
  Eye,
  Tag,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { productService } from '../services/services';
import PageTransition from '../components/layout/PageTransition';
import Loader from '../components/ui/Loader';
import EmptyState from '../components/ui/EmptyState';
import { formatPrice, formatDate, cn } from '../utils/format';
import { ScrollReveal, RevealOnScroll } from '../components/ui/ScrollReveal';
import MagneticButton from '../components/ui/MagneticButton';

export default function MyProducts() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    productService
      .my()
      .then((r) => setItems(r.data.items))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id) => {
    if (!confirm('Delete this listing? This action cannot be undone.')) return;
    try {
      await productService.delete(id);
      setItems((prev) => prev.filter((p) => p._id !== id));
      toast.success('Listing deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  const handleMarkSold = async (id) => {
    try {
      await productService.markSold(id);
      setItems((prev) =>
        prev.map((p) => (p._id === id ? { ...p, status: p.status === 'sold' ? 'active' : 'sold' } : p))
      );
      toast.success('Listing updated');
    } catch {
      toast.error('Failed to update');
    }
  };

  if (loading) return <Loader />;

  return (
    <PageTransition>
      <div className="relative">

        <div className="container-page py-8 md:py-12 relative z-10">
          <ScrollReveal direction="up">
            <div className="flex items-center justify-between mb-10">
              <div>
                <motion.h1
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="font-display font-bold text-3xl md:text-4xl mb-2"
                >
                  My Listings
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-slate-500"
                >
                  {items.length} total listing{items.length !== 1 && 's'}
                </motion.p>
              </div>
              <motion.Link
                to="/sell"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="btn-primary"
              >
                <Plus className="w-4 h-4" />
                New Listing
              </motion.Link>
            </div>
          </ScrollReveal>

          {items.length === 0 ? (
            <ScrollReveal delay={0.2} direction="up">
              <EmptyState
                title="No listings yet"
                description="Create your first listing to start selling"
                action={
                  <Link to="/sell" className="btn-primary">
                    <Plus className="w-4 h-4" />
                    Create Listing
                  </Link>
                }
              />
            </ScrollReveal>
          ) : (
            <RevealOnScroll delay={0.1} className="space-y-3">
              {items.map((p, i) => (
                <motion.div
                  key={p._id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="card p-4 flex flex-col sm:flex-row gap-4 hover:shadow-xl transition-all"
                >
                  <Link
                    to={`/product/${p._id}`}
                    className="flex-shrink-0 w-full sm:w-32 h-32 rounded-xl overflow-hidden bg-slate-100"
                  >
                    <img
                      src={p.images?.[0]?.url || 'https://via.placeholder.com/300'}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </Link>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <Link
                        to={`/product/${p._id}`}
                        className="font-semibold hover:text-brand-600 line-clamp-1"
                      >
                        {p.title}
                      </Link>
                      <span
                        className={cn(
                          'badge flex-shrink-0',
                          p.status === 'active' && 'bg-emerald-100 text-emerald-700',
                          p.status === 'sold' && 'bg-slate-100 text-slate-700',
                          p.status === 'pending' && 'bg-amber-100 text-amber-700',
                          p.status === 'rejected' && 'bg-red-100 text-red-700'
                        )}
                      >
                        {p.status}
                      </span>
                    </div>

                    <p className="text-sm text-slate-500 line-clamp-1 mb-2">{p.description}</p>

                    <div className="flex items-center gap-3 mb-3">
                      <span className="font-display font-bold text-lg">
                        {formatPrice(p.price)}
                      </span>
                      {p.views > 0 && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Eye className="w-3 h-3" /> {p.views}
                        </span>
                      )}
                      <span className="text-xs text-slate-500">
                        Listed {formatDate(p.createdAt)}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <motion.button
                        onClick={() => handleMarkSold(p._id)}
                        whileTap={{ scale: 0.97 }}
                        className="btn-secondary text-xs"
                      >
                        {p.status === 'sold' ? (
                          <>
                            <XCircle className="w-3 h-3" />
                            Mark as Active
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-3 h-3" />
                            Mark as Sold
                          </>
                        )}
                      </motion.button>
                      <Link to={`/edit/${p._id}`} className="btn-secondary text-xs">
                        <Edit3 className="w-3 h-3" />
                        Edit
                      </Link>
                      <motion.button
                        onClick={() => handleDelete(p._id)}
                        whileTap={{ scale: 0.97 }}
                        className="btn text-xs text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </RevealOnScroll>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
