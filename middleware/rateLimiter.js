const rateLimit = require('express-rate-limit');

/**
 * Custom key generator to strip port numbers from IP addresses.
 * Resolves: ERR_ERL_INVALID_IP_ADDRESS (e.g., 106.192.14.190:46688)
 */
const cleanKeyGenerator = (req) => {
  // Checks X-Forwarded-For (Azure) or fallback to standard req.ip
  const ip = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
  
  // If IP is an array, take the first one; then split by colon to remove port
  const singleIp = Array.isArray(ip) ? ip[0] : ip;
  return singleIp.split(':')[0].trim();
};

// Strict: For Login, Register, Forgot Password
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 20, 
  message: { message: "Too many login attempts. Please try again later." },
  keyGenerator: cleanKeyGenerator, // ✅ Added fix
  standardHeaders: true,
  legacyHeaders: false,
});

// Relaxed: For Dashboard, Profile, etc.
exports.apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 100, 
  message: { message: "Too many requests. Please slow down." },
  keyGenerator: cleanKeyGenerator, // ✅ Added fix
  skip: (req) => process.env.NODE_ENV === 'development',
  standardHeaders: true,
  legacyHeaders: false,
});