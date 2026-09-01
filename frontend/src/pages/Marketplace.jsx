import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, SlidersHorizontal, X, Filter } from 'lucide-react';
import { productService, categoryService } from '../services/services';
import ProductCard from '../components/product/ProductCard';
import { SkeletonGrid } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import PageTransition from '../components/layout/PageTransition';
import { ScrollReveal, RevealOnScroll } from '../components/ui/ScrollReveal';
import MagneticButton from '../components/ui/MagneticButton';

export default function Marketplace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    q: searchParams.get('q') || '',
    category: searchParams.get('category') || '',
    brand: searchParams.get('brand') || '',
    condition: searchParams.get('condition') || '',
    minPrice: searchParams.get('minPrice') || '',
    maxPrice: searchParams.get('maxPrice') || '',
    location: searchParams.get('location') || '',
    sort: searchParams.get('sort') || 'newest',
    page: 1,
  });
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  useEffect(() => {
    categoryService.list().then((r) => setCategories(r.data.categories));
    productService.brands().then((r) => setBrands(r.data.brands));
  }, []);

  useEffect(() => {
    setLoading(true);
    productService
      .list(filters)
      .then((r) => {
        setProducts(r.data.items);
        setPagination(r.data.pagination);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filters]);

  const setFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({
      q: '',
      category: '',
      brand: '',
      condition: '',
      minPrice: '',
      maxPrice: '',
      location: '',
      sort: 'newest',
      page: 1,
    });
  };

  const activeFilterCount = useMemo(
    () =>
      ['category', 'brand', 'condition', 'minPrice', 'maxPrice', 'location'].filter(
        (k) => filters[k]
      ).length,
    [filters]
  );

  return (
    <PageTransition>
      <div className="relative">

        <div className="container-page py-8 md:py-12 relative z-10">
          {/* Header */}
          <ScrollReveal direction="up">
            <div className="mb-8">
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="font-display font-bold text-3xl md:text-4xl mb-2"
              >
                Marketplace
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-slate-500"
              >
                Discover unique items from verified sellers
              </motion.p>
            </div>
          </ScrollReveal>

          {/* Search & Filter Bar */}
          <ScrollReveal delay={0.1} direction="up">
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={filters.q}
                  onChange={(e) => setFilter('q', e.target.value)}
                  placeholder="Search products..."
                  className="input pl-12"
                />
              </div>

              <div className="flex items-center gap-2">
                <MagneticButton
                  type="button"
                  onClick={() => setShowFilters((s) => !s)}
                  className="btn-secondary relative"
                  strength={0.15}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  <span className="hidden sm:inline">Filters</span>
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-brand-500 text-white text-xs rounded-full grid place-items-center">
                      {activeFilterCount}
                    </span>
                  )}
                </MagneticButton>

                <select
                  value={filters.sort}
                  onChange={(e) => setFilter('sort', e.target.value)}
                  className="input max-w-[180px] hidden sm:block"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="popular">Most Popular</option>
                </select>
              </div>
            </div>
          </ScrollReveal>

          {/* Filters Panel */}
          <AnimatePresence>
            {showFilters && (
              <ScrollReveal delay={0.2} direction="down">
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mb-6"
                >
                  <div className="card p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-display font-semibold">Filters</h3>
                      {activeFilterCount > 0 && (
                        <button
                          onClick={clearFilters}
                          className="text-sm text-slate-500 hover:text-red-600 flex items-center gap-1"
                        >
                          <X className="w-3 h-3" />
                          Clear all
                        </button>
                      )}
                    </div>
                    <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-3">
                      <select
                        value={filters.category}
                        onChange={(e) => setFilter('category', e.target.value)}
                        className="input"
                      >
                        <option value="">All categories</option>
                        {categories.map((c) => (
                          <option key={c._id} value={c._id}>{c.name}</option>
                        ))}
                      </select>
                      <select
                        value={filters.brand}
                        onChange={(e) => setFilter('brand', e.target.value)}
                        className="input"
                      >
                        <option value="">All brands</option>
                        {brands.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                      <select
                        value={filters.condition}
                        onChange={(e) => setFilter('condition', e.target.value)}
                        className="input"
                      >
                        <option value="">Any condition</option>
                        <option value="new">New</option>
                        <option value="like-new">Like New</option>
                        <option value="good">Good</option>
                        <option value="fair">Fair</option>
                        <option value="poor">Poor</option>
                      </select>
                      <input
                        type="number"
                        value={filters.minPrice}
                        onChange={(e) => setFilter('minPrice', e.target.value)}
                        placeholder="Min price"
                        className="input"
                      />
                      <input
                        type="number"
                        value={filters.maxPrice}
                        onChange={(e) => setFilter('maxPrice', e.target.value)}
                        placeholder="Max price"
                        className="input"
                      />
                      <input
                        type="text"
                        value={filters.location}
                        onChange={(e) => setFilter('location', e.target.value)}
                        placeholder="Location"
                        className="input"
                      />
                    </div>
                  </div>
                </motion.div>
              </ScrollReveal>
            )}
          </AnimatePresence>

          {/* Results */}
          <ScrollReveal delay={showFilters ? 0.3 : 0.2} direction="up">
            <AnimatePresence mode="wait">
              {loading ? (
                <SkeletonGrid key="loading" count={8} />
              ) : products.length === 0 ? (
                <EmptyState
                  key="empty"
                  title="No products found"
                  description="Try adjusting your filters or search query"
                  action={
                    <button onClick={clearFilters} className="btn-primary">
                      Clear filters
                    </button>
                  }
                />
              ) : (
                <>
                  <motion.p
                    key="count"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-sm text-slate-500 mb-4"
                  >
                    Showing {products.length} of {pagination.total} products
                  </motion.p>

                  <RevealOnScroll delay={0.05} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {products.map((p, i) => (
                      <ProductCard key={p._id} product={p} index={i} />
                    ))}
                  </RevealOnScroll>

                  {/* Pagination */}
                  {pagination.pages > 1 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-10 flex justify-center gap-2"
                    >
                      {Array.from({ length: pagination.pages }).map((_, i) => (
                        <motion.button
                          key={i}
                          onClick={() => setFilter('page', i + 1)}
                          whileTap={{ scale: 0.9 }}
                          className={`w-10 h-10 rounded-xl font-medium text-sm transition ${
                            filters.page === i + 1
                              ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/25'
                              : 'bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {i + 1}
                        </motion.button>
                      ))}
                    </motion.div>
                  )}
                </>
              )}
            </AnimatePresence>
          </ScrollReveal>
        </div>
      </div>
    </PageTransition>
  );
}
