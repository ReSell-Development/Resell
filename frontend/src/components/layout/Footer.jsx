import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, Twitter, Instagram, Github, Mail, ArrowRight } from 'lucide-react';

export default function Footer() {
  return (
    <motion.footer
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="border-t border-slate-200 bg-white/80 backdrop-blur-xl mt-16 relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-grid opacity-50" />
      <div className="container-page py-12 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12"
        >
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 grid place-items-center shadow-lg shadow-brand-500/30">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="font-display font-extrabold text-xl">
                Re<span className="gradient-text">Sell</span>
              </span>
            </Link>
            <p className="text-sm text-slate-500 max-w-md mb-6">
              The AI-powered peer-to-peer marketplace. Smart pricing, computer vision,
              trust scoring, and real-time chat — all in one beautiful experience.
            </p>
            <div className="flex gap-3">
              {[
                { icon: Twitter, href: '#' },
                { icon: Instagram, href: '#' },
                { icon: Github, href: '#' },
                { icon: Mail, href: '#' },
              ].map((item, i) => (
                <motion.a
                  key={i}
                  href={item.href}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  whileHover={{ scale: 1.1, y: -2 }}
                  className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-brand-100 hover:text-brand-600 grid place-items-center transition-all"
                >
                  <item.icon className="w-4 h-4" />
                </motion.a>
              ))}
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-sm text-slate-900 mb-3">Marketplace</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              {['Browse', 'Trending', 'New Arrivals', 'Sell an item'].map((item, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05 }}>
                  <Link to={item === 'Sell an item' ? '/sell' : `/marketplace${item === 'Trending' ? '?sort=popular' : item === 'New Arrivals' ? '?sort=newest' : ''}`} className="hover:text-slate-900 transition-colors">
                    {item}
                  </Link>
                </motion.li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm text-slate-900 mb-3">Company</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              {['About', 'Trust & Safety', 'Privacy', 'Terms'].map((item, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05 }}>
                  <a href="#" className="hover:text-slate-900 transition-colors">{item}</a>
                </motion.li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm text-slate-900 mb-3">Support</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              {['Help Center', 'Contact Us', 'Seller Guide', 'Buyer Protection'].map((item, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05 }}>
                  <a href="#" className="hover:text-slate-900 transition-colors">{item}</a>
                </motion.li>
              ))}
            </ul>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-12 pt-8 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4"
        >
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} ReSell. All rights reserved.
          </p>
          <p className="text-xs text-slate-400">
            Built with AI · Designed for trust
          </p>
        </motion.div>
      </div>
    </motion.footer>
  );
}