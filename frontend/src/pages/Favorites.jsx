import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { favoriteService } from '../services/services';
import ProductCard from '../components/product/ProductCard';
import PageTransition from '../components/layout/PageTransition';
import EmptyState from '../components/ui/EmptyState';
import Loader from '../components/ui/Loader';
import { Heart, ArrowRight } from 'lucide-react';
import { ScrollReveal, RevealOnScroll } from '../components/ui/ScrollReveal';

export default function Favorites() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    favoriteService
      .list()
      .then((r) => setItems(r.data.items))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  return (
    <PageTransition>
      <div className="relative">

        <div className="container-page py-8 md:py-12 relative z-10">
          <ScrollReveal direction="up">
            <div className="mb-10">
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="font-display font-bold text-3xl md:text-4xl mb-2 flex items-center gap-3"
              >
                <Heart className="w-8 h-8 text-accent-500" />
                Your Favorites
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-slate-500"
              >
                {items.length} saved item{items.length !== 1 && 's'}
              </motion.p>
            </div>
          </ScrollReveal>

          {items.length === 0 ? (
            <ScrollReveal delay={0.2} direction="up">
              <EmptyState
                icon={Heart}
                title="No favorites yet"
                description="Start browsing and save items you love"
                action={
                  <motion.a
                    href="/marketplace"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="btn-primary inline-flex items-center gap-2"
                  >
                    Browse Marketplace
                    <ArrowRight className="w-4 h-4" />
                  </motion.a>
                }
              />
            </ScrollReveal>
          ) : (
            <RevealOnScroll delay={0.1} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {items.map((p, i) => (
                <ProductCard key={p._id} product={p} index={i} />
              ))}
            </RevealOnScroll>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
