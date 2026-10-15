import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authService } from '../services/services';
import { clearApiCache } from '../services/api';

const AuthContext = createContext(null);

// Retry budget for the initial "who am I" call. A backend restart makes /api
// unreachable for a few seconds; without this the user is shown as logged out
// even though their httpOnly cookies are still perfectly valid.
const BOOT_RETRY_DELAYS_MS = [500, 1000, 2000, 4000];

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const mountedRef = useRef(false);
  const requestRef = useRef(0);

  const loadUser = useCallback(async () => {
    const request = ++requestRef.current;
    const isCurrent = () => mountedRef.current && request === requestRef.current;

    // A backend restart (`npm run dev` / nodemon) makes /api unreachable for a
    // few seconds. During that window a page refresh must NOT clear the
    // session: the httpOnly cookies are still perfectly valid, we simply have
    // not been able to confirm the session yet. Retry with a short backoff
    // while keeping the loading state, and never treat an unreachable backend
    // as "logged out".
    for (let attempt = 0; attempt <= BOOT_RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) {
        if (!isCurrent()) return;
        await new Promise((resolve) => setTimeout(resolve, BOOT_RETRY_DELAYS_MS[attempt - 1]));
        if (!isCurrent()) return;
      }

      let error = null;
      try {
        const { data } = await authService.me();
        if (isCurrent()) {
          setUser(data.user);
          setLoading(false);
        }
        return; // authenticated — stop retrying
      } catch (err) {
        error = err;
        if (!isCurrent()) return;
        const status = err?.response?.status;

        if (status === 401 || status === 403) {
          // The server explicitly rejected the session (expired and not
          // refreshable, revoked, suspended...) — treat as logged out.
          console.error('[Auth] Load user failed:', err);
          setUser(null);
          setLoading(false);
          return;
        }

        // No response at all (network error) or a 5xx: transient outage such
        // as a backend restart. Keep `loading` (so the UI keeps showing the
        // spinner instead of a logged-out nav) and try again.
      }
    }

    // Out of retries: do NOT clear user state and do NOT redirect to /login.
    // The cookies are still valid — a later request or page load will
    // authenticate again once the backend is reachable.
    console.error('[Auth] Backend unreachable during boot, session preserved:', error?.message || error);
    if (isCurrent()) setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadUser();
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, [loadUser]);

  const login = async (credentials) => {
    const request = ++requestRef.current;
    // Drop cached GET responses from any previous session so a different
    // user on the same browser never sees stale protected data.
    clearApiCache();
    try {
      const { data } = await authService.login(credentials);
      if (mountedRef.current && request === requestRef.current) setUser(data.user);
      return data.user;
    } finally {
      if (mountedRef.current && request === requestRef.current) setLoading(false);
    }
  };

  const register = async (userData) => {
    const request = ++requestRef.current;
    clearApiCache();
    try {
      const { data } = await authService.register(userData);
      if (mountedRef.current && request === requestRef.current) setUser(data.user);
      return data.user;
    } finally {
      if (mountedRef.current && request === requestRef.current) setLoading(false);
    }
  };

  const logout = async () => {
    const request = ++requestRef.current;
    clearApiCache();
    try {
      await authService.logout();
    } catch {
    } finally {
      clearApiCache();
      if (mountedRef.current && request === requestRef.current) {
        setUser(null);
        setLoading(false);
      }
    }
  };

  const updateUser = (updates) => {
    setUser((prev) => ({ ...prev, ...updates }));
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser, refresh: loadUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
