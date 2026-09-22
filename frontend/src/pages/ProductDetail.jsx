import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart,
  Share2,
  Flag,
  MessageCircle,
  MapPin,
  Calendar,
  Eye,
  ChevronLeft,
  ShieldCheck,
  ChevronRight,
  Send,
  Tag,
  Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { productService, favoriteService, chatService, reportService, sellerService, offerService } from '../services/services';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, getConditionLabel, getConditionColor, cn } from '../utils/format';
import ImageGallery from '../components/product/ImageGallery';
import AIAnalysisPanel from '../components/product/AIAnalysisPanel';
import SellerInfo from '../components/product/SellerInfo';
import ProductCard from '../components/product/ProductCard';
import DeliveryAddressForm from '../components/checkout/DeliveryAddressForm';
import Price from '../components/ui/Price';
import useFormatPrice from '../hooks/useFormatPrice';
import PageTransition from '../components/layout/PageTransition';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import { ScrollReveal, RevealOnScroll } from '../components/ui/ScrollReveal';
import MagneticButton from '../components/ui/MagneticButton';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [trust, setTrust] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [favorited, setFavorited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [showOfferModal, setShowOfferModal] = useState(false);

  useEffect(() => {
    setLoading(true);
    productService
      .get(id)
      .then((r) => setProduct(r.data.product))
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));

    productService.similar(id).then((r) => setSimilar(r.data.items)).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!product) return;
    if (product.seller?._id) {
      sellerService.trust(product.seller._id).then((r) => setTrust(r.data.trust)).catch(() => {});
    }
    if (user) {
      favoriteService.check(id).then((r) => setFavorited(r.data.favorited)).catch(() => {});
    }
  }, [product, user, id]);

  const handleFavorite = async () => {
    if (!user) {
      toast.error('Please log in to save items');
      return;
    }
    try {
      if (favorited) {
        await favoriteService.remove(id);
        setFavorited(false);
        toast.success('Removed from favorites');
      } else {
        await favoriteService.add(id);
        setFavorited(true);
        toast.success('Added to favorites');
      }
    } catch {
      toast.error('Failed to update favorite');
    }
  };

  const handleContactSeller = async () => {
    if (!user) {
      toast.error('Please log in to message the seller');
      return;
    }
    if (product.seller._id === user._id) {
      toast.error('You cannot message yourself');
      return;
    }
    setShowAddressModal(true);
  };

  const handleAddressConfirmed = async (address) => {
    setShowAddressModal(false);
    try {
      const { data } = await chatService.createConversation({
        recipientId: product.seller._id,
        productId: product._id,
      });
      try {
        const addrText = [
          `Hi! I'm interested in "${product.title}".`,
          '',
          'Delivery address:',
          address.fullName,
          address.phone,
          address.line1,
          address.line2,
          [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
          address.country,
        ].filter(Boolean).join('\n');
        await chatService.send({ conversationId: data.conversation._id, content: addrText });
      } catch {
        /* conversation was created; first message can be sent from chat page */
      }
      navigate(`/chat/${data.conversation._id}`);
    } catch {
      toast.error('Failed to start conversation');
    }
  };

  const handleReport = async (data) => {
    try {
      await reportService.create({
        targetType: 'product',
        target: id,
        ...data,
      });
      toast.success('Report submitted. Thank you.');
      setShowReport(false);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit report');
    }
  };

  const handleOffer = async ({ amount, message }) => {
    if (!user) {
      toast.error('Please log in to make an offer');
      return;
    }
    if (product.seller._id === user._id) {
      toast.error('You cannot make an offer on your own listing');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      toast.error('Enter a valid offer amount');
      return;
    }
    if (Number(amount) >= product.price) {
      toast.error('Offer must be below the listed price');
      return;
    }
    try {
      await offerService.create({
        productId: product._id,
        amount: Number(amount),
        message,
      });
      toast.success('Offer sent to seller');
      setShowOfferModal(false);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send offer');
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: product.title, url });
      } catch {
        /* user cancelled */
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied to clipboard');
      } catch {
        toast.error('Could not copy link');
      }
    }
  };

  if (loading) return <Loader />;
  if (!product) return <ErrorState title="Product not found" />;

  return (
    <PageTransition>
      <div className="relative">

        <div className="container-page py-8 relative z-10">
          {/* Back button */}
          <ScrollReveal direction="left">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6 group"
            >
              <motion.div
                whileHover={{ x: -4 }}
                className="w-8 h-8 rounded-xl bg-white border border-slate-200 grid place-items-center shadow-sm group-hover:shadow-md transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </motion.div>
              <span className="font-medium">Back</span>
            </button>
          </ScrollReveal>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Left: Gallery + Details */}
            <div className="lg:col-span-2 space-y-6">
              <ScrollReveal direction="up">
                <ImageGallery images={product.images} />
              </ScrollReveal>

              <ScrollReveal delay={0.1} direction="up">
                <div className="card p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className={cn('badge border', getConditionColor(product.condition))}>
                          {getConditionLabel(product.condition)}
                        </span>
                        {product.brand && (
                          <span className="badge bg-slate-100 text-slate-700">{product.brand}</span>
                        )}
                        {product.category && (
                          <span className="badge bg-brand-50 text-brand-700">{product.category.name}</span>
                        )}
                      </div>
                      <h1 className="font-display font-bold text-2xl md:text-3xl mb-2">{product.title}</h1>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1">
                          <Eye className="w-4 h-4" /> {product.views} views
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" /> {formatDate(product.createdAt)}
                        </span>
                        {product.location?.city && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-4 h-4" /> {product.location.city}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mb-6">
                    <Price
                      amount={product.price}
                      originalPrice={product.originalPrice}
                      fromCurrency={product.currencyCode || 'USD'}
                      size="lg"
                    />
                    {product.originalPrice > product.price && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="badge bg-emerald-100 text-emerald-700">
                          Save {Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>

                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-slate-700 leading-relaxed whitespace-pre-line mb-6"
                  >
                    {product.description}
                  </motion.p>

                  {product.specifications?.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="border-t border-slate-200 pt-6"
                    >
                      <h3 className="font-semibold mb-3">Specifications</h3>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {product.specifications.map((s, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.03 }}
                            className="flex justify-between p-3 rounded-lg bg-slate-50 text-sm"
                          >
                            <span className="text-slate-500">{s.key}</span>
                            <span className="font-medium">{s.value}</span>
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </div>
              </ScrollReveal>

              {/* Similar Items */}
              {similar.length > 0 && (
                <ScrollReveal delay={0.2} direction="up">
                  <div className="card p-6">
                    <h3 className="font-display font-bold text-xl mb-4">Similar Items</h3>
                    <RevealOnScroll delay={0.05} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {similar.slice(0, 4).map((s, i) => (
                        <ProductCard key={s._id} product={s} index={i} />
                      ))}
                    </RevealOnScroll>
                  </div>
                </ScrollReveal>
              )}
            </div>

            {/* Right: Actions + AI + Seller */}
            <div className="space-y-6">
              <ScrollReveal delay={0.1} direction="up">
                <div className="flex gap-2">
                  <motion.button
                    onClick={handleFavorite}
                    whileTap={{ scale: 0.95 }}
                    whileHover={{ scale: 1.02 }}
                    className={cn(
                      'flex-1 btn',
                      favorited
                        ? 'bg-accent-50 border border-accent-200 text-accent-700 hover:bg-accent-100'
                        : 'btn-secondary'
                    )}
                  >
                    <motion.div
                      animate={{
                        scale: favorited ? 1 : 0.8,
                        rotate: favorited ? 0 : -180,
                      }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    >
                      <Heart className={cn('w-4 h-4', favorited && 'fill-accent-500')} />
                    </motion.div>
                    {favorited ? 'Saved' : 'Save'}
                  </motion.button>
                  <motion.button
                    onClick={handleShare}
                    whileTap={{ scale: 0.95 }}
                    className="btn-secondary"
                    title="Share"
                    aria-label="Share listing"
                  >
                    <Share2 className="w-4 h-4" />
                  </motion.button>
                  <motion.button
                    onClick={() => setShowReport(true)}
                    whileTap={{ scale: 0.95 }}
                    className="btn-secondary"
                    title="Report"
                    aria-label="Report listing"
                  >
                    <Flag className="w-4 h-4" />
                  </motion.button>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.15} direction="up">
                <AIAnalysisPanel aiAnalysis={product.aiAnalysis} />
              </ScrollReveal>

              <ScrollReveal delay={0.2} direction="up">
                <SellerInfo
                  seller={product.seller}
                  trust={trust}
                  onMessage={handleContactSeller}
                />
              </ScrollReveal>

              {product.status !== 'sold' && (
                <ScrollReveal delay={0.25} direction="up">
                  <motion.button
                    onClick={() => setShowOfferModal(true)}
                    whileTap={{ scale: 0.97 }}
                    whileHover={{ scale: 1.01 }}
                    className="w-full btn-secondary py-3 text-base"
                  >
                    <Tag className="w-5 h-5" />
                    Make an Offer
                  </motion.button>
                </ScrollReveal>
              )}

              <ScrollReveal delay={0.3} direction="up">
                <MagneticButton
                  onClick={handleContactSeller}
                  className="w-full btn-primary py-3 text-base"
                  strength={0.15}
                >
                  <MessageCircle className="w-5 h-5" />
                  Chat with Seller
                </MagneticButton>
              </ScrollReveal>

              {product.status === 'sold' && (
                <ScrollReveal delay={0.3} direction="up">
                  <div className="card p-4 text-center bg-slate-50 border-slate-300">
                    <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="font-semibold text-slate-700">This item has been sold</p>
                  </div>
                </ScrollReveal>
              )}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {showReport && (
            <ReportModal
              onClose={() => setShowReport(false)}
              onSubmit={handleReport}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showAddressModal && (
            <AddressModal
              product={product}
              initialValues={user ? { fullName: user.name || '' } : null}
              onConfirm={handleAddressConfirmed}
              onClose={() => setShowAddressModal(false)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showOfferModal && (
            <OfferModal
              product={product}
              onClose={() => setShowOfferModal(false)}
              onSubmit={handleOffer}
            />
          )}
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}

function AddressModal({ product, initialValues, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 grid place-items-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-xl">Where should we deliver?</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100" type="button">
            <ChevronRight className="w-5 h-5 rotate-90" />
          </button>
        </div>
        <DeliveryAddressForm
          product={product}
          initialValues={initialValues}
          onConfirm={onConfirm}
          onCancel={onClose}
        />
      </motion.div>
    </div>
  );
}

function ReportModal({ onClose, onSubmit }) {
  const [reason, setReason] = useState('spam');
  const [description, setDescription] = useState('');

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 grid place-items-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="card p-6 w-full max-w-md"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-xl">Report Listing</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100"
          >
            <ChevronRight className="w-5 h-5 rotate-90" />
          </button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ reason, description }); }} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="input">
              <option value="spam">Spam</option>
              <option value="fake">Fake / Counterfeit</option>
              <option value="fraud">Fraud / Scam</option>
              <option value="inappropriate">Inappropriate</option>
              <option value="duplicate">Duplicate Listing</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Additional details</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="input"
              placeholder="Tell us what's wrong..."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" className="btn-danger flex-1">Submit Report</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function OfferModal({ product, onClose, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const value = Number(amount);
    if (!amount || Number.isNaN(value) || value <= 0) {
      setError('Enter a valid offer amount');
      return;
    }
    if (value >= product.price) {
      setError('Offer must be below the listed price');
      return;
    }
    onSubmit({ amount: value, message });
  };

  const formatPrice = useFormatPrice(product?.currencyCode || 'USD');

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="offer-modal-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="card p-6 w-full max-w-md"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 grid place-items-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <h3 id="offer-modal-title" className="font-display font-bold text-xl">Make an Offer</h3>
        </div>

        <div className="mb-5 p-4 rounded-xl bg-slate-50 border border-slate-200">
          <p className="text-xs text-slate-500 mb-1">Listed price</p>
          <p className="font-display font-bold text-2xl gradient-text">
            {formatPrice(product.price)}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="offer-amount" className="block text-sm font-medium mb-1">
              Your offer
            </label>
            <div className="relative">
              <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="offer-amount"
                type="number"
                min="1"
                step="1"
                max={product.price - 1}
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError(''); }}
                placeholder="0"
                className="input pl-10"
                autoFocus
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="offer-message" className="block text-sm font-medium mb-1">
              Message <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="offer-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={500}
              className="input"
              placeholder="Hi! Would you accept..."
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">{error}</p>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button type="submit" className="btn-primary flex-1">
              <Send className="w-4 h-4" />
              Submit Offer
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
