const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');

// Standard protected routes for the app
router.post('/create-order', protect, paymentController.createOrder);
router.post('/verify-payment', protect, paymentController.verifyPayment);

// Webhook endpoint for Razorpay (No 'protect' middleware)
router.post('/webhook', paymentController.handleWebhook);

module.exports = router;