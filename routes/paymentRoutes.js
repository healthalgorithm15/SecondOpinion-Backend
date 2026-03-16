const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');

router.post('/create-order', protect, paymentController.createOrder);
router.post('/verify-payment', protect, paymentController.verifyPayment);

// Public: Razorpay will hit this even if the user is logged out of the app
router.post('/webhook', paymentController.handleWebhook);

module.exports = router;