const rateLimit = require('express-rate-limit');

// Strict: For Login, Register, Forgot Password
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 20, // Only 20 attempts per 15 mins
  message: { message: "Too many login attempts. Please try again later." }
});

// Relaxed: For Dashboard, Profile, etc.
exports.apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 100, // 100 requests per minute
  message: { message: "Too many requests. Please slow down." },
  skip: (req) => process.env.NODE_ENV === 'development', // Skip in Dev
});