import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, Sparkles, LogIn, ArrowRight, ShieldCheck, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import PageTransition from '../components/layout/PageTransition';
import MagneticButton from '../components/ui/MagneticButton';
import { ScrollReveal } from '../components/ui/ScrollReveal';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(form);
      toast.success(`Welcome back, ${user.name}!`);
      const from = location.state?.from || (user.role === 'admin' ? '/admin/dashboard' : '/');
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed');
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
            className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-accent-600 items-center justify-center p-12"
            initial={{ opacity: 0, x: -40 }}
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
                Welcome back to ReSell
              </motion.div>

              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="font-display font-extrabold text-4xl md:text-5xl mb-6"
              >
                The smartest marketplace for buying and selling pre-loved items.
              </motion.h2>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="space-y-4"
              >
                {[
                  { icon: Sparkles, text: 'AI-powered pricing & recommendations' },
                  { icon: ShieldCheck, text: 'Trust scoring & verification' },
                  { icon: MessageCircle, text: 'Real-time chat with sellers' },
                  { icon: ArrowRight, text: 'Instant listings with computer vision' },
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 + i * 0.1 }}
                    className="flex items-center gap-4"
                  >
                    <motion.div
                      className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur grid place-items-center"
                      whileHover={{ scale: 1.1, rotate: 6 }}
                    >
                      <item.icon className="w-5 h-5 text-white" />
                    </motion.div>
                    <span className="text-white/90">{item.text}</span>
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
                  Log in
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-slate-500"
                >
                  Welcome back! Please enter your details.
                </motion.p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <ScrollReveal delay={0.2} direction="up">
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

                <ScrollReveal delay={0.25} direction="up">
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder="••••••••"
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

                <ScrollReveal delay={0.3} direction="up">
                  <MagneticButton
                    type="submit"
                    disabled={loading}
                    className="w-full btn-primary py-3.5"
                    strength={0.15}
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <motion.div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Logging in...
                      </span>
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        Log in
                      </>
                    )}
                  </MagneticButton>
                </ScrollReveal>
              </form>

              <ScrollReveal delay={0.35} direction="up">
                <div className="mt-8 text-center text-sm text-slate-500">
                  Don't have an account?{' '}
                  <Link to="/register" className="text-brand-600 font-medium hover:underline">
                    Sign up
                  </Link>
                </div>
              </ScrollReveal>
            </motion.div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
