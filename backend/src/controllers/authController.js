const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { generateToken, generateRefreshToken, setTokenCookies, clearTokenCookies, verifyToken } = require('../utils/jwt');
const { blacklistToken } = require('../utils/tokenBlacklist');
const {
  persistRefreshToken,
  findRefreshTokenRecord,
  isRefreshTokenRecordUsable,
  rotateRefreshToken,
  revokeRefreshToken,
} = require('../services/refreshTokenService');
const AppError = require('../utils/AppError');

// Expiry (ms epoch) of a freshly signed refresh token, mirrored into its DB
// row so the record and the JWT agree on lifetime (default 7d).
const refreshTokenExpiryMs = (token) => {
  const decoded = jwt.decode(token);
  if (decoded && Number.isFinite(decoded.exp)) return decoded.exp * 1000;
  return Date.now() + 7 * 24 * 60 * 60 * 1000;
};

const register = async (req, res, next) => {
  try {
    const { name, email, password, role, location } = req.body;

    if (!name || !email || !password) {
      throw new AppError('Name, email and password are required', 400, 'VALIDATION_ERROR');
    }

    const existing = await User.findOne({ email });
    if (existing) {
      throw new AppError('Email is already registered', 400, 'DUPLICATE_EMAIL');
    }

    const user = await User.create({
      name,
      email,
      password,
      role: role === 'seller' ? 'seller' : 'buyer',
      location: location || '',
    });

    const token = generateToken({ id: user._id, role: user.role });
    const refreshToken = generateRefreshToken({ id: user._id, role: user.role });

    // DB-persist the refresh token so logout/rotation survive restarts.
    // Fail closed: a token with no record can never be refreshed.
    await persistRefreshToken({
      token: refreshToken,
      userId: user._id,
      expiresAt: refreshTokenExpiryMs(refreshToken),
    });

    setTokenCookies(res, token, refreshToken);

    user.password = undefined;
    res.status(201).json({
      success: true,
      user,
    });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new AppError('Email and password are required', 400, 'VALIDATION_ERROR');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    if (!user) {
      throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AppError('Account is inactive', 401, 'INACTIVE_ACCOUNT');
    }

    const match = await user.comparePassword(password);
    if (!match) {
      throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    user.lastSeen = new Date();
    await user.save();

    const token = generateToken({ id: user._id, role: user.role });
    const refreshToken = generateRefreshToken({ id: user._id, role: user.role });

    // DB-persist the refresh token so logout/rotation survive restarts.
    await persistRefreshToken({
      token: refreshToken,
      userId: user._id,
      expiresAt: refreshTokenExpiryMs(refreshToken),
    });

    setTokenCookies(res, token, refreshToken);

    user.password = undefined;
    res.json({
      success: true,
      user,
    });
  } catch (err) {
    next(err);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const updates = {};
    const allowed = ['name', 'bio', 'phone', 'location', 'avatar'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      throw new AppError('Both passwords are required', 400, 'VALIDATION_ERROR');
    }
    const user = await User.findById(req.user._id).select('+password');
    const match = await user.comparePassword(currentPassword);
    if (!match) {
      throw new AppError('Current password is incorrect', 401, 'INVALID_CREDENTIALS');
    }
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    next(err);
  }
};

const logout = async (req, res) => {
  // Blacklist both access and refresh tokens so they can't be reused
  const accessToken = req.cookies?.access_token;
  const refreshToken = req.cookies?.refresh_token;

  if (accessToken) {
    try {
      const decoded = verifyToken(accessToken);
      blacklistToken(decoded.jti, decoded.exp * 1000);
    } catch { /* token may already be expired — still blacklist by jti if possible */ }
  }
  if (refreshToken) {
    // Durable revocation: mark the DB row revoked so the refresh endpoint
    // rejects this token even after a backend restart. The in-memory JWT
    // blacklist (used above for the access token) is wiped on reboot and is
    // NOT consulted by /refresh — the persisted RefreshToken record is the
    // kill switch that survives restarts.
    try {
      await revokeRefreshToken(refreshToken);
    } catch { /* non-fatal — cookies are cleared regardless */ }
  }

  clearTokenCookies(res);
  res.json({ success: true, message: 'Logged out successfully' });
};

const refreshAccessToken = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;

    // No refresh token present — clear stale cookies and signal the client to
    // stop retrying immediately (distinct code: REFRESH_TOKEN_MISSING).
    if (!refreshToken) {
      clearTokenCookies(res);
      return res.status(401).json({
        success: false,
        message: 'Refresh token missing',
        code: 'REFRESH_TOKEN_MISSING',
      });
    }

    let decoded;
    try {
      decoded = verifyToken(refreshToken);
    } catch {
      // Invalid or expired — clear cookies so the browser won't keep sending them.
      clearTokenCookies(res);
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token',
        code: 'REFRESH_TOKEN_INVALID',
      });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      clearTokenCookies(res);
      return res.status(401).json({
        success: false,
        message: 'User no longer exists or is inactive',
        code: 'REFRESH_TOKEN_INVALID',
      });
    }

    // The presented refresh token must have a live DB record: unknown,
    // revoked (logout / already rotated), or expired rows are rejected.
    // This is what makes revocation survive backend restarts.
    const record = await findRefreshTokenRecord(refreshToken);
    if (!isRefreshTokenRecordUsable(record)) {
      clearTokenCookies(res);
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token',
        code: 'REFRESH_TOKEN_INVALID',
      });
    }

    const newAccessToken = generateToken({ id: user._id, role: user.role });
    const newRefreshToken = generateRefreshToken({ id: user._id, role: user.role });

    // Single-use rotation: the presented token is revoked and linked to its
    // successor, so a replayed (stolen or double-used) refresh token fails.
    await rotateRefreshToken({
      oldToken: refreshToken,
      newToken: newRefreshToken,
      userId: user._id,
      newExpiresAt: refreshTokenExpiryMs(newRefreshToken),
    });

    setTokenCookies(res, newAccessToken, newRefreshToken);

    res.json({
      success: true,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  login,
  logout,
  getMe,
  updateProfile,
  changePassword,
  refreshAccessToken,
};
