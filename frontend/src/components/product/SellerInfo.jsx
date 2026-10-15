import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Star, ShieldCheck, MessageCircle, MapPin } from 'lucide-react';
import TrustBadge from '../ui/TrustBadge';

export default function SellerInfo({ seller, trust, onMessage }) {
  if (!seller) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="card p-6"
    >
      <div className="flex items-start gap-4 mb-4">
        <Link to={`/seller/${seller._id}`} className="flex-shrink-0">
          {seller.avatar?.url ? (
            <img
              src={seller.avatar.url}
              alt={seller.name}
              className="w-16 h-16 rounded-2xl object-cover ring-2 ring-slate-100"
            />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500 grid place-items-center text-white font-bold text-xl">
              {seller.name?.[0]?.toUpperCase()}
            </div>
          )}
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Link
              to={`/seller/${seller._id}`}
              className="font-semibold text-slate-900 hover:text-brand-600"
            >
              {seller.name}
            </Link>
            {seller.isVerified && (
              <ShieldCheck className="w-4 h-4 text-blue-500" />
            )}
          </div>
          {seller.bio && (
            <p className="text-sm text-slate-500 line-clamp-2 mb-2">{seller.bio}</p>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-slate-500">
            {seller.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {seller.location}
              </span>
            )}
            {trust && (
              <span className="flex items-center gap-1">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                {trust.level}
              </span>
            )}
          </div>
        </div>
      </div>

      {trust && (
        <div className="mb-4">
          <TrustBadge score={trust.score} level={trust.level} size="md" />
        </div>
      )}

      {onMessage && (
        <button
          onClick={onMessage}
          className="w-full btn-secondary text-sm"
        >
          <MessageCircle className="w-4 h-4" />
          Message Seller
        </button>
      )}
    </motion.div>
  );
}
