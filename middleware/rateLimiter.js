const rateLimit = require('express-rate-limit');

/**
 * 🛠️ Helper: Extracts a clean IP from Azure/Proxy headers
 * This addresses the "ERR_ERL_INVALID_IP_ADDRESS" and "ERR_ERL_KEY_GEN_IPV6"
 */
const getCleanIp = (req) => {
    // 1. Check Azure/Proxy forwarded header first
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp = forwarded ? forwarded.split(',')[0] : req.ip || req.connection.remoteAddress;
    
    // 2. Remove port numbers if they exist (common in Azure/local testing)
    // Works for both IPv4 (127.0.0.1:5000) and IPv6 ([::1]:5000)
    return rawIp.replace(/(.*):(\d+)$/, '$1').replace(/[\[\]]/g, '');
};

// 🛡️ General API Limiter
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getCleanIp(req), // Use our cleaner
    validate: { xForwardedForHeader: false }, // Disable internal check to use our custom logic
});

// 🔐 Auth Limiter (Login/OTP)
const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    message: { message: "Too many attempts. Please try again after an hour." },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getCleanIp(req),
    validate: { xForwardedForHeader: false },
});

module.exports = { apiLimiter, authLimiter };