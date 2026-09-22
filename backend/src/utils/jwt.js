const jwt = require('jsonwebtoken');

const crypto = require('crypto');

const generateToken = (payload) => {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '1h',
  });
};

const generateRefreshToken = (payload) => {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

/**
 * Set auth tokens as httpOnly cookies on the response.
 * - access_token: short-lived, readable by the server for auth
 * - refresh_token: long-lived, used only by the /refresh endpoint
 */
const setTokenCookies = (res, accessToken, refreshToken) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  // Determine sameSite based on whether CLIENT_URL is on a different *domain*.
  // Comparing full origins (including port) is wrong — localhost:3000 and
  // localhost:5000 are same-site.  Only different hostnames (e.g. example.com
  // vs api.example.com) should use 'none'.  SameSite=None also requires
  // Secure=true, which we don't set in development, so using it there would
  // cause browsers to silently drop the cookie entirely.
  let sameSite = 'lax';
  try {
    const clientHost = new URL(clientUrl).hostname;
    const serverHost = new URL(`http://localhost:${process.env.PORT || 5000}`).hostname;
    if (clientHost !== serverHost) sameSite = 'none';
  } catch { /* ignore */ }

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    maxAge: 60 * 60 * 1000, // 1 hour
    path: '/',
  });

  if (refreshToken) {
    // Set refresh token cookie on root path so it is sent with /api/auth/refresh requests.
  // Using '/' broadens scope but simplifies token refresh flow.
  res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });
  }
};

const clearTokenCookies = (res) => {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' }); // must match the path set in setTokenCookies
};

module.exports = {
  generateToken,
  generateRefreshToken,
  verifyToken,
  setTokenCookies,
  clearTokenCookies,
};
