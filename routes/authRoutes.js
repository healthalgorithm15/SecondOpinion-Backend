const express = require('express');
const router = express.Router();

// 1. Import Controllers
const { register, verifyEmail, completeOnboarding } = require('../controllers/registerController');
const { login, verifyOTP, googleLogin } = require('../controllers/loginController');
const { forgotPassword, resetPassword, updatePassword } = require('../controllers/passwordController');
const { getMe, logout } = require('../controllers/sessionController');
const { getDashboard } = require('../controllers/patientController');

const { apiLimiter, authLimiter } = require('../middleware/rateLimiter'); 
const { protect, authorize } = require('../middleware/authMiddleware');

// --- PUBLIC ROUTES ---

// Signup & Email Verification
router.post('/register', apiLimiter, register);
router.get('/verify-email/:token', verifyEmail);

// Login Flow
router.post('/login', authLimiter, login);
router.post('/google', googleLogin);

// OTP Verification (MFA and Password Reset)
router.post('/verify-otp', apiLimiter, verifyOTP);

// Forgot Password & Resend Logic
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/resend-otp', authLimiter, forgotPassword);

// Reset Password (Web & Mobile)
router.post('/reset-password/:token', authLimiter, resetPassword);
router.post('/reset-password', authLimiter, resetPassword);


// --- PROTECTED ROUTES (Requires Bearer Token) ---

// Session & Profile (This is what the Super Admin uses to check their session)
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);

// Security: Change password from settings
router.put('/update-password', protect, updatePassword);

// Patient Specific Data
router.get('/patient/dashboard', protect, getDashboard); 

// The Doctor must be logged in (protect) to change their password
router.post('/complete-onboarding', protect, completeOnboarding);

module.exports = router;