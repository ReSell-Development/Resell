import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/services';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      // Auth is now cookie-based — the server reads the httpOnly access_token cookie.
      // If the cookie is missing/expired, the server returns 401 and the API
      // interceptor will attempt a refresh before redirecting to login.
      const { data } = await authService.me();
      setUser(data.user);
    } catch (err) {
      console.error('[Auth] Load user failed:', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = async (credentials) => {
    const { data } = await authService.login(credentials);
    // Tokens are set as httpOnly cookies by the server — no localStorage needed.
    setUser(data.user);
    return data.user;
  };

  const register = async (userData) => {
    const { data } = await authService.register(userData);
    // Tokens are set as httpOnly cookies by the server — no localStorage needed.
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await authService.logout();
    } catch (err) {
      /* ignore */
    }
    // Server clears the httpOnly cookies.
    setUser(null);
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
