import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Coins, Check } from 'lucide-react';
import { useCurrency } from '../../contexts/CurrencyContext';
import { SUPPORTED_CURRENCIES } from '../../utils/currency';
import { cn } from '../../utils/format';

export default function CurrencySelector({ compact = false }) {
  const { currency, setCurrency, rates, loading } = useCurrency();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const current = SUPPORTED_CURRENCIES.find((c) => c.code === currency) || SUPPORTED_CURRENCIES[0];

  return (
    <div className="relative" ref={ref}>
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.95 }}
        className={cn(
          'flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-sm font-medium text-slate-700 backdrop-blur transition-all hover:border-brand-400 hover:bg-white',
          compact && 'px-2 py-1 text-xs'
        )}
        aria-label="Select currency"
      >
        <Coins className="h-3.5 w-3.5 text-brand-600" />
        <span className="font-semibold">{current.code}</span>
        <span className="hidden text-slate-500 sm:inline">{current.symbol}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform', open && 'rotate-180')} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 z-50 mt-3 max-h-80 w-64 overflow-y-auto rounded-2xl border border-slate-100 bg-white/95 shadow-2xl backdrop-blur-2xl"
          >
            <div className="border-b border-slate-100 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Display Currency</p>
              {rates && (
                <p className="mt-0.5 text-[10px] text-slate-400">
                  Rates updated{' '}
                  {new Date(rates.fetchedAt || Date.now()).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              )}
              {loading && <p className="mt-0.5 text-[10px] text-slate-400">Refreshing…</p>}
            </div>
            <div className="space-y-0.5 p-1.5">
              {SUPPORTED_CURRENCIES.map((c) => {
                const active = c.code === currency;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => {
                      setCurrency(c.code);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50',
                      active && 'bg-brand-50'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-base">{c.flag}</span>
                      <div>
                        <p className={cn('font-semibold', active ? 'text-brand-700' : 'text-slate-900')}>{c.code}</p>
                        <p className="text-xs text-slate-500">{c.name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-400">{c.symbol}</span>
                      {active && <Check className="h-4 w-4 text-brand-600" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
