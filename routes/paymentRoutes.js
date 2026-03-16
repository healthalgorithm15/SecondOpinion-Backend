const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');

// Debugging: This will print in your terminal to ensure functions are loading
console.log("Loading Payment Routes...");
console.log("- CreateOrder Loaded:", typeof paymentController.createOrder === 'function');
console.log("- VerifyPayment Loaded:", typeof paymentController.verifyPayment === 'function');
console.log("- Webhook Loaded:", typeof paymentController.handleWebhook === 'function');

// Create Order (Protected)
router.post('/create-order', protect, paymentController.createOrder);

// Verify Payment (Protected)
router.post('/verify-payment', protect, paymentController.verifyPayment);

// Webhook (Public - called by Razorpay)
router.post('/webhook', paymentController.handleWebhook);

module.exports = router;