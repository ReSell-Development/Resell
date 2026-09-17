import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// No manual Authorization header needed — httpOnly cookies are sent automatically.

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config;

    // If 401 and not already retrying, attempt token refresh
    if (err.response?.status === 401 && !originalRequest._retry) {
      const path = window.location.pathname;
      if (path.startsWith('/login') || path.startsWith('/register')) {
        return Promise.reject(err);
      }

      originalRequest._retry = true;
      try {
        await api.post('/auth/refresh');
        // Retry the original request — the new access_token cookie is set
        return api(originalRequest);
      } catch {
        // Refresh failed — redirect to login
        const currentPath = window.location.pathname;
        if (!currentPath.startsWith('/login')) {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(err);
  }
);

export default api;
