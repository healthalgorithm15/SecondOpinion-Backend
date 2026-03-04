const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Blacklist = require('../models/BlackList');

/**
 * 🛡️ 1. Protect Middleware
 * Verifies the JWT Token from Headers or Query String
 */
exports.protect = async (req, res, next) => {
  let token;

  // 1. Check for token in headers (Standard for Mobile/API)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } 
  // 2. Fallback: Check for token in URL query (Required for Web iframes)
  else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Session expired, please login' });
  }

  try {
    // Check if token is blacklisted
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