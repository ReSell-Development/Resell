import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  ShoppingBag,
  Heart,
  MessageCircle,
  User,
  LogOut,
  LayoutDashboard,
  Plus,
  Menu,
  X,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../utils/format';
import MagneticButton from '../ui/MagneticButton';
import CurrencySelector from '../ui/CurrencySelector';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 24);
    handler();
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  useEffect(() => {
    setUserMenuOpen(false);
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/marketplace?q=${encodeURIComponent(searchQuery)}`);
      setSearchOpen(false);
      setSearchQuery('');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const navLinks = [
    { to: '/marketplace', label: 'Browse', match: (s) => s.get('sort') !== 'popular' && s.get('sort') !== 'newest' },
    { to: '/marketplace?sort=popular', label: 'Trending', match: (s) => s.get('sort') === 'popular' },
    { to: '/marketplace?sort=newest', label: 'New Arrivals', match: (s) => s.get('sort') === 'newest' },
  ];

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4"
    >
      <div
        className={cn(
          'container-page rounded-2xl transition-all duration-500',
          scrolled
            ? 'border border-white/60 bg-white/75 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.18)] backdrop-blur-2xl'
            : 'border border-transparent bg-transparent'
        )}
      >
        <div className="flex items-center justify-between px-2 py-2.5 sm:px-3">
          {/* Logo */}
          <Link to="/" className="group relative z-10 flex items-center gap-2">
            <motion.div
              whileHover={{ rotate: 90, scale: 1.08 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 via-violet-500 to-accent-500 shadow-lg shadow-brand-500/30"
            >
              <Sparkles className="h-4 w-4 text-white" />
            </motion.div>
            <span className="font-display text-xl font-extrabold tracking-tight text-slate-900 md:text-2xl">
              Re<span className="gradient-text">Sell</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="nav-links relative hidden items-center gap-0.5 lg:flex" role="navigation" aria-label="Main">
            {navLinks.map((link) => {
              const isActive =
                location.pathname + location.search === link.to ||
                (location.pathname === '/marketplace' && link.match(new URLSearchParams(location.search)));
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cn(
                    'group relative rounded-full px-4 py-2 text-sm font-medium transition-all duration-200',
                    isActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-full bg-white shadow-sm ring-1 ring-slate-200/80"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className="relative z-10">{link.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Search bar (desktop) */}
          <div className="mx-4 hidden max-w-xs flex-1 xl:block">
            <form onSubmit={handleSearch} className="relative w-full">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search anything..."
                className={cn(
                  'w-full rounded-xl border py-2 pl-10 pr-4 text-sm outline-none transition-all',
                  scrolled
                    ? 'border-slate-200 bg-slate-50/80 focus:border-brand-400 focus:bg-white'
                    : 'border-white/50 bg-white/60 backdrop-blur focus:border-brand-400 focus:bg-white'
                )}
              />
            </form>
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-1.5">
            <motion.button
              onClick={() => setSearchOpen(true)}
              className="rounded-xl p-2 transition-colors hover:bg-white/70 xl:hidden"
              aria-label="Search"
              whileTap={{ scale: 0.9 }}
            >
              <Search className="h-5 w-5 text-slate-600" />
            </motion.button>

            <div className="hidden sm:block">
              <CurrencySelector />
            </div>

            {user ? (
              <>
                <MagneticButton
                  to="/sell"
                  strength={0.2}
                  className="hidden rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition-shadow hover:shadow-xl sm:inline-flex"
                >
                  <Plus className="h-4 w-4" />
                  Sell
                </MagneticButton>

                <IconLink to="/favorites" label="Favorites">
                  <Heart className="h-5 w-5 text-slate-600 transition-colors group-hover:text-accent-500" />
                </IconLink>

                <IconLink to="/chat" label="Messages">
                  <MessageCircle className="h-5 w-5 text-slate-600 transition-colors group-hover:text-brand-600" />
                </IconLink>

                <div className="relative">
                  <motion.button
                    onClick={() => setUserMenuOpen((s) => !s)}
                    className="flex items-center gap-1.5 rounded-full p-1 transition-colors hover:bg-white/70"
                    whileTap={{ scale: 0.95 }}
                    aria-label="Account menu"
                  >
                    {user.avatar?.url ? (
                      <img
                        src={user.avatar.url}
                        alt={user.name}
                        className="h-8 w-8 rounded-full object-cover shadow-md ring-2 ring-white"
                      />
                    ) : (
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-sm font-semibold text-white">
                        {user.name?.[0]?.toUpperCase() || 'U'}
                      </div>
                    )}
                    <ChevronDown
                      className={cn('hidden h-4 w-4 text-slate-500 transition-transform sm:block', userMenuOpen && 'rotate-180')}
                    />
                  </motion.button>

                  <AnimatePresence>
                    {userMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.96 }}
                        transition={{ duration: 0.18 }}
                        className="absolute right-0 mt-3 w-56 overflow-hidden rounded-2xl border border-slate-100 bg-white/95 shadow-2xl backdrop-blur-2xl"
                      >
                        <div className="border-b border-slate-100 p-4">
                          <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                          <p className="truncate text-xs text-slate-500">{user.email}</p>
                        </div>
                        <div className="space-y-0.5 p-1.5">
                          {[
                            { to: '/profile', icon: User, label: 'Profile' },
                            { to: '/my-products', icon: ShoppingBag, label: 'My Listings' },
                            { to: '/favorites', icon: Heart, label: 'Favorites' },
                            { to: '/chat', icon: MessageCircle, label: 'Messages' },
                          ].map((item) => (
                            <Link
                              key={item.to}
                              to={item.to}
                              onClick={() => setUserMenuOpen(false)}
                              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                            >
                              <item.icon className="h-4 w-4" />
                              {item.label}
                            </Link>
                          ))}
                          {user.role === 'admin' && (
                            <Link
                              to="/admin/dashboard"
                              onClick={() => setUserMenuOpen(false)}
                              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                            >
                              <LayoutDashboard className="h-4 w-4" />
                              Admin Panel
                            </Link>
                          )}
                          <button
                            onClick={handleLogout}
                            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-600 transition-colors hover:bg-red-50"
                          >
                            <LogOut className="h-4 w-4" />
                            Logout
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            ) : (
              <>
                <Link to="/login" className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex">
                  Log in
                </Link>
                <MagneticButton
                  to="/register"
                  strength={0.2}
                  className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition-shadow hover:shadow-xl"
                >
                  Sign up
                </MagneticButton>
              </>
            )}

            <motion.button
              onClick={() => setMenuOpen((s) => !s)}
              className="rounded-xl p-2.5 transition-colors hover:bg-white/70 lg:hidden"
              whileTap={{ scale: 0.9 }}
              aria-label="Menu"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </motion.button>
          </div>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden lg:hidden"
            >
              <div className="space-y-1 border-t border-slate-100 py-3">
                {navLinks.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-xl px-4 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    {link.label}
                  </Link>
                ))}
                {user ? (
                  <>
                    {[
                      { to: '/sell', icon: Plus, label: 'Sell Item' },
                      { to: '/favorites', icon: Heart, label: 'Favorites' },
                      { to: '/chat', icon: MessageCircle, label: 'Messages' },
                    ].map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-3 rounded-xl px-4 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <item.icon className="h-5 w-5" />
                        {item.label}
                      </Link>
                    ))}
                    <div className="px-4 py-2 sm:hidden">
                      <CurrencySelector compact />
                    </div>
                  </>
                ) : (
                  <>
                    <Link
                      to="/login"
                      onClick={() => setMenuOpen(false)}
                      className="block rounded-xl px-4 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      Log in
                    </Link>
                    <div className="px-4 py-2 sm:hidden">
                      <CurrencySelector compact />
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile search overlay */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setSearchOpen(false)}
          >
            <motion.div
              initial={{ y: -30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -30, opacity: 0 }}
              className="bg-white p-6 pt-8"
              onClick={(e) => e.stopPropagation()}
            >
              <form onSubmit={handleSearch} className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search anything..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-4 pl-12 pr-4 text-lg outline-none focus:border-brand-500"
                  />
                </div>
                <motion.button
                  type="button"
                  onClick={() => setSearchOpen(false)}
                  className="rounded-xl bg-slate-100 p-3 hover:bg-slate-200"
                  whileTap={{ scale: 0.9 }}
                  aria-label="Close search"
                >
                  <X className="h-5 w-5" />
                </motion.button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}

function IconLink({ to, label, children }) {
  return (
    <Link
      to={to}
      aria-label={label}
      className="group hidden rounded-xl p-2 transition-colors hover:bg-white/70 sm:flex"
    >
      {children}
    </Link>
  );
}
