const express = require('express');
const router = express.Router();

// 1. Import Controllers
const { register, verifyEmail, completeOnboarding } = require('../controllers/registerController');
const { login, verifyOTP, googleLogin } = require('../controllers/loginController');
const { forgotPassword, resetPassword, updatePassword, resendOTP } = require('../controllers/passwordController');
const { getMe, updateProfile, logout, updatePushToken } = require('../controllers/sessionController'); // 🟢 Added updatePushToken
const { getDashboard } = require('../controllers/patientController');

const { apiLimiter, authLimiter } = require('../middleware/rateLimiter'); 
const { protect, authorize } = require('../middleware/authMiddleware');

// --- PUBLIC ROUTES ---
router.post('/register', apiLimiter, register);
router.get('/verify-email/:token', verifyEmail);
router.post('/login', authLimiter, login);
router.post('/google', googleLogin);
router.post('/verify-otp', apiLimiter, verifyOTP);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/resend-otp', authLimiter, resendOTP);
router.post('/reset-password/:token', authLimiter, resetPassword);
router.post('/reset-password', authLimiter, resetPassword);

// --- PROTECTED ROUTES (Requires Bearer Token) ---

// Session & Profile
router.get('/me', protect, getMe);
router.patch('/profile', protect, updateProfile);
router.post('/logout', protect, logout);

/**
 * 🟢 PRODUCTION FIX: Push Token Endpoint
 * This prevents the 404 error seen in the mobile console.
 * Ensure 'updatePushToken' is defined in your sessionController.
 */
router.patch('/update-push-token', protect, updatePushToken);

// Security
router.put('/update-password', protect, updatePassword);

// Patient Specific Data
router.get('/patient/dashboard', protect, getDashboard); 

// Onboarding
router.post('/complete-onboarding', protect, completeOnboarding);

module.exports = router;