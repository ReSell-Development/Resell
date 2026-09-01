import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, Star, Calendar, MapPin, MessageCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { sellerService, chatService } from '../services/services';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, getConditionLabel, formatPrice, getTrustColor } from '../utils/format';
import TrustBadge from '../components/ui/TrustBadge';
import ProductCard from '../components/product/ProductCard';
import PageTransition from '../components/layout/PageTransition';
import Loader from '../components/ui/Loader';
import { ScrollReveal, RevealOnScroll } from '../components/ui/ScrollReveal';
import MagneticButton from '../components/ui/MagneticButton';

export default function SellerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sellerService
      .profile(id)
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load seller'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleMessage = async () => {
    if (!user) return navigate('/login');
    if (user._id === id) return toast.error('Cannot message yourself');
    try {
      const { data: conv } = await chatService.createConversation({ recipientId: id });
      navigate(`/chat/${conv.conversation._id}`);
    } catch {
      toast.error('Failed to start chat');
    }
  };

  if (loading) return <Loader />;
  if (!data) return null;
  const { seller, trust, products, reviews } = data;
  const activeProducts = products.filter((p) => p.status === 'active');

  return (
    <PageTransition>
      <div className="relative">

        <div className="container-page py-8 relative z-10">
          {/* Header card */}
          <ScrollReveal direction="up">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="card overflow-hidden mb-6"
            >
              <div className="h-32 bg-gradient-to-r from-brand-500 via-brand-600 to-accent-500" />
              <div className="p-6 -mt-12">
                <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                  {seller.avatar?.url ? (
                    <motion.img
                      src={seller.avatar.url}
                      alt=""
                      className="w-24 h-24 rounded-2xl border-4 border-white object-cover shadow-xl"
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    />
                  ) : (
                    <motion.div
                      className="w-24 h-24 rounded-2xl border-4 border-white bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white font-bold text-3xl shadow-xl"
                      initial={{ scale: 0.8, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      {seller.name?.[0]?.toUpperCase()}
                    </motion.div>
                  )}

                  <div className="flex-1">
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2"
                    >
                      <h1 className="font-display font-bold text-2xl">{seller.name}</h1>
                      {seller.isVerified && (
                        <ShieldCheck className="w-5 h-5 text-blue-500" />
                      )}
                    </motion.div>
                    <motion.p
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="text-slate-500 text-sm mt-1"
                    >
                      {seller.bio || 'No bio yet'}
                    </motion.p>
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="flex flex-wrap gap-4 mt-3 text-sm text-slate-500"
                    >
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        Joined {formatDate(seller.createdAt)}
                      </span>
                      {seller.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {seller.location}
                        </span>
                      )}
                    </motion.div>
                  </div>

                  <MagneticButton
                    onClick={handleMessage}
                    className="btn-primary"
                    strength={0.15}
                  >
                    <MessageCircle className="w-4 h-4" />
                    Message
                  </MagneticButton>
                </div>
              </div>
            </motion.div>
          </ScrollReveal>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Trust score */}
            <ScrollReveal delay={0.1} direction="up">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="card p-6"
              >
                <h3 className="font-display font-bold text-lg mb-4">Trust Score</h3>
                <div className="text-center mb-4">
                  <motion.div
                    initial={{ scale: 0.5 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className={`text-6xl font-display font-extrabold bg-gradient-to-r ${getTrustColor(trust.score)} bg-clip-text text-transparent`}
                  >
                    {trust.score}
                  </motion.div>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-slate-500 capitalize mt-1"
                  >
                    {trust.level}
                  </motion.p>
                </div>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="space-y-3 text-sm"
                >
                  {trust.breakdown && Object.entries(trust.breakdown).map(([key, val]) => (
                    <motion.div
                      key={key}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center justify-between"
                    >
                      <span className="text-slate-600 capitalize">
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </span>
                      <span className="font-semibold">
                        {val.score}/{val.max}
                      </span>
                    </motion.div>
                  ))}
                </motion.div>
              </motion.div>
            </ScrollReveal>

            {/* Listings + Reviews */}
            <div className="lg:col-span-2 space-y-6">
              <ScrollReveal delay={0.15} direction="up">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="card p-6"
                >
                  <h3 className="font-display font-bold text-lg mb-4">
                    Active Listings ({activeProducts.length})
                  </h3>
                  {activeProducts.length === 0 ? (
                    <p className="text-slate-500 text-sm">No active listings</p>
                  ) : (
                    <RevealOnScroll delay={0.05} className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {activeProducts.slice(0, 6).map((p, i) => (
                        <ProductCard key={p._id} product={p} index={i} />
                      ))}
                    </RevealOnScroll>
                  )}
                </motion.div>
              </ScrollReveal>

              <ScrollReveal delay={0.2} direction="up">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="card p-6"
                >
                  <h3 className="font-display font-bold text-lg mb-4">Recent Reviews</h3>
                  {reviews.length === 0 ? (
                    <p className="text-slate-500 text-sm">No reviews yet</p>
                  ) : (
                    <motion.div className="space-y-4">
                      {reviews.map((r) => (
                        <motion.div
                          key={r._id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="border-b last:border-0 pb-4 last:pb-0"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                  key={i}
                                  className={`w-4 h-4 ${
                                    i < r.rating
                                      ? 'fill-amber-400 text-amber-400'
                                      : 'text-slate-300'
                                  }`}
                                />
                              ))}
                            </div>
                            <span className="text-sm text-slate-500">{r.buyer?.name}</span>
                            <span className="text-xs text-slate-400">{formatDate(r.createdAt)}</span>
                          </div>
                          <p className="text-sm text-slate-700">{r.comment}</p>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </motion.div>
              </ScrollReveal>
            </div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
