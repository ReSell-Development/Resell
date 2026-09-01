const User = require('../models/User');
const { generateToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');

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

    res.status(201).json({
      success: true,
      token,
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
    console.log({ email: normalizedEmail, userFound: !!user, storedHash: user?.password });
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

    user.password = undefined;
    res.json({
      success: true,
      token,
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
  // JWT is stateless; client just drops the token
  res.json({ success: true, message: 'Logged out successfully' });
};

module.exports = {
  register,
  login,
  logout,
  getMe,
  updateProfile,
  changePassword,
};
