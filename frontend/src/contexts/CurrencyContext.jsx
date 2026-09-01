import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import { SUPPORTED_CURRENCIES, resolveCurrency, isSupportedCurrency } from '../utils/currency';
import { useAuth } from './AuthContext';

const CurrencyContext = createContext(null);

const STORAGE_KEY = 'resell:currency';

export const CurrencyProvider = ({ children }) => {
  const { user } = useAuth();
  const [rates, setRates] = useState(null);
  const [base, setBase] = useState('USD');
  const [supported, setSupported] = useState(SUPPORTED_CURRENCIES.map((c) => c.code));
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currency, setCurrencyState] = useState(() => {
    if (typeof window === 'undefined') return 'USD';
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved && isSupportedCurrency(saved) ? saved : null;
  });

  useEffect(() => {
    let cancelled = false;
    const fetchRates = async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/exchange-rates/rates');
        if (cancelled) return;
        setRates(data.rates);
        setBase(data.base || 'USD');
        setSupported(data.supported || SUPPORTED_CURRENCIES.map((c) => c.code));
        setFetchedAt(data.fetchedAt || new Date().toISOString());
      } catch (err) {
        console.warn('[Currency] Failed to load exchange rates', err?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchRates();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (currency) return;
    const detected = resolveCurrency({ saved: null, userLocation: user?.location });
    setCurrencyState(detected);
  }, [user?.location, currency]);

  const setCurrency = useCallback((code) => {
    if (!isSupportedCurrency(code)) return;
    setCurrencyState(code);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, code);
    }
  }, []);

  const refreshRates = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/exchange-rates/rates');
      setRates(data.rates);
      setFetchedAt(data.fetchedAt || new Date().toISOString());
    } catch {
      /* swallow */
    } finally {
      setLoading(false);
    }
  }, []);

  const value = {
    currency: currency || 'USD',
    base,
    rates,
    supported,
    fetchedAt,
    loading,
    setCurrency,
    refreshRates,
  };

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
};

export const useCurrency = () => {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider');
  return ctx;
};
