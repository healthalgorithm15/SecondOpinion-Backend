const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Blacklist = require('../models/BlackList');

/**
 * 🛡️ 1. Protect Middleware
 * Verifies the JWT Token and attaches the user to the request object.
 */
exports.protect = async (req, res, next) => {
  let token;

  // Check for token in headers
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Session expired, please login' });
  }

  try {
    // Check if token is blacklisted (useful for logout logic)
    const isBlacklisted = await Blacklist.findOne({ token });
    if (isBlacklisted) {
      return res.status(401).json({ success: false, message: 'Session expired' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user to request (excluding password)
    req.user = await User.findById(decoded.id).select('-password');
    
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error.message);
    const message = error.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token';
    res.status(401).json({ success: false, message });
  }
};

/**
 * 🛡️ 2. Authorize Middleware
 * Restricts access to specific roles (e.g., 'admin', 'doctor')
 * Usage: authorize('admin') or authorize('admin', 'doctor')
 */
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: `User role ${req.user?.role || 'None'} is not authorized to access this route` 
      });
    }
    next();
  };
};