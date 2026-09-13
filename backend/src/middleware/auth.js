const { verifyToken } = require('../utils/jwt');
const { isBlacklisted } = require('../utils/tokenBlacklist');
const User = require('../models/User');
const AppError = require('../utils/AppError');

const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.access_token) {
      token = req.cookies.access_token;
    }

    if (!token) {
      return next(new AppError('Not authenticated. Please log in.', 401, 'UNAUTHORIZED'));
    }

    const decoded = verifyToken(token);

    if (decoded.jti && isBlacklisted(decoded.jti)) {
      return next(new AppError('Token has been revoked. Please log in again.', 401, 'TOKEN_REVOKED'));
    }

    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return next(new AppError('User no longer exists or is inactive', 401, 'UNAUTHORIZED'));
    }

    if (user.suspendedUntil && user.suspendedUntil > new Date()) {
      return next(new AppError('Account is suspended', 403, 'SUSPENDED'));
    }

    req.user = user;
    next();
  } catch (err) {
    next(new AppError('Invalid or expired token', 401, 'TOKEN_INVALID'));
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Not authenticated', 401, 'UNAUTHORIZED'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Not authorized to perform this action', 403, 'FORBIDDEN'));
    }
    next();
  };
};

const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (token) {
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.id);
      if (user && user.isActive) req.user = user;
    }
  } catch (err) {
    /* ignore */
  }
  next();
};

module.exports = { protect, authorize, optionalAuth };
