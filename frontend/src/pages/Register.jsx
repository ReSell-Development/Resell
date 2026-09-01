import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, User, MapPin, Eye, EyeOff, Sparkles, UserPlus, Store, ShoppingBag, ArrowRight, ShieldCheck, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import PageTransition from '../components/layout/PageTransition';
import MagneticButton from '../components/ui/MagneticButton';
import LocationDetectButton from '../components/ui/LocationDetectButton';
import useLocationDetector from '../hooks/useLocationDetector';
import { ScrollReveal } from '../components/ui/ScrollReveal';

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'buyer',
    location: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { detect: detectLocation, loading: detectingLocation, error: locationError } = useLocationDetector();

  const handleDetectLocation = async () => {
    const result = await detectLocation();
    if (result) {
      setForm((f) => ({ ...f, location: result.label }));
      toast.success('Location detected — feel free to edit it');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await register(form);
      toast.success(`Welcome to ReSell, ${user.name}!`);
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageTransition>
      <div className="relative min-h-screen">

        <div className="min-h-screen grid lg:grid-cols-2 relative z-10">
          {/* Left side - Brand */}
          <motion.div
            className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-accent-600 via-accent-700 to-brand-600 items-center justify-center p-12"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <div className="absolute inset-0 bg-grid opacity-10" />

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="relative text-white max-w-md z-10"
            >
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.3, type: 'spring', stiffness: 300, damping: 20 }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur border border-white/20 text-white text-sm font-medium mb-8"
              >
                <Sparkles className="w-4 h-4" />
                Join ReSell Today
              </motion.div>

              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="font-display font-extrabold text-4xl md:text-5xl mb-4"
              >
                Create an account and unlock the smartest peer-to-peer marketplace experience.
              </motion.h2>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="grid grid-cols-2 gap-4"
              >
                {[
                  { icon: ShoppingBag, title: 'Find great deals', desc: 'Browse thousands of verified items' },
                  { icon: Store, title: 'Sell with AI', desc: 'Smart pricing & instant listings' },
                  { icon: ShieldCheck, title: 'Trust & safety', desc: 'Verified sellers & escrow protection' },
                  { icon: MessageCircle, title: 'Real-time chat', desc: 'Connect instantly with buyers/sellers' },
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.6 + i * 0.08 }}
                    className="p-4 rounded-xl bg-white/10 backdrop-blur hover:bg-white/20 transition-colors"
                    whileHover={{ y: -4 }}
                  >
                    <item.icon className="w-6 h-6 mb-2" />
                    <p className="font-medium">{item.title}</p>
                    <p className="text-xs text-white/70 mt-1">{item.desc}</p>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          </motion.div>

          {/* Right side - Form */}
          <div className="flex items-center justify-center p-6 lg:p-12 min-h-screen">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="w-full max-w-md"
            >
              <div className="mb-10">
                <motion.h1
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="font-display font-bold text-3xl mb-2"
                >
                  Create account
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-slate-500"
                >
                  Get started in less than a minute.
                </motion.p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <ScrollReveal delay={0.2} direction="up">
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Full name</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="text"
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder=""
                        className="input pl-11"
                      />
                    </div>
                  </div>
                </ScrollReveal>

                <ScrollReveal delay={0.25} direction="up">
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        placeholder=""
                        className="input pl-11"
                      />
                    </div>
                  </div>
                </ScrollReveal>

                <ScrollReveal delay={0.3} direction="up">
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder="At least 6 characters"
                        className="input pl-11 pr-11"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                </ScrollReveal>

                <ScrollReveal delay={0.35} direction="up">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-slate-700">Location</label>
                      <LocationDetectButton
                        onDetect={handleDetectLocation}
                        loading={detectingLocation}
                        error={locationError}
                      />
                    </div>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="text"
                        value={form.location}
                        onChange={(e) => setForm({ ...form, location: e.target.value })}
                        placeholder=""
                        className="input pl-11"
                      />
                    </div>
                  </div>
                </ScrollReveal>

                <ScrollReveal delay={0.4} direction="up">
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">I want to</label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { value: 'buyer', label: 'Buy items', icon: ShoppingBag },
                        { value: 'seller', label: 'Sell items', icon: Store },
                      ].map((opt) => (
                        <motion.button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm({ ...form, role: opt.value })}
                          whileTap={{ scale: 0.97 }}
                          whileHover={{ scale: 1.02 }}
                          className={`p-3 rounded-xl border-2 flex items-center gap-2 transition ${
                            form.role === opt.value
                              ? 'border-brand-500 bg-brand-50 text-brand-700'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <opt.icon className="w-4 h-4" />
                          <span className="text-sm font-medium">{opt.label}</span>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </ScrollReveal>

                <ScrollReveal delay={0.45} direction="up">
                  <MagneticButton
                    type="submit"
                    disabled={loading}
                    className="w-full btn-primary py-3.5"
                    strength={0.15}
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <motion.div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Creating...
                      </span>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        Create Account
                      </>
                    )}
                  </MagneticButton>
                </ScrollReveal>
              </form>

              <ScrollReveal delay={0.5} direction="up">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-8 text-center text-sm text-slate-500"
                >
                  Already have an account?{' '}
                  <Link to="/login" className="text-brand-600 font-medium hover:underline">
                    Log in
                  </Link>
                </motion.div>
              </ScrollReveal>
            </motion.div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
