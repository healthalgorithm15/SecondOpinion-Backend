const crypto = require('crypto');
const Razorpay = require('razorpay');
const Transaction = require('../models/Transaction');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const SCAN_PRICE_INR = 500; 

/**
 * @desc    Step 1: Create a Razorpay Order
 * @route   POST /api/payments/create-order
 */
exports.createOrder = async (req, res) => {
  try {
    const { scanId, patientId } = req.body; 

    if (!patientId) {
      return res.status(400).json({ message: "Patient ID is required" });
    }

    const options = {
      amount: SCAN_PRICE_INR * 100, // Razorpay expects paise
      currency: "INR",
      receipt: `rcpt_${scanId === 'new_scan' ? 'new' : scanId}_${Date.now()}`,
      notes: { patientId, scanId } 
    };

    const order = await razorpay.orders.create(options);

    // If this is a new scan analysis, we store scanId as null.
    // This allows the dashboard to find "Unused" credits easily.
    const safeScanId = (scanId === 'new_scan' || !scanId) ? null : scanId;

    await Transaction.create({
      patientId,
      scanId: safeScanId, 
      orderId: order.id,
      amount: SCAN_PRICE_INR,
      status: 'pending'
    });

    res.status(200).json(order);
  } catch (error) {
    console.error("❌ Razorpay Order Error:", error);
    res.status(500).json({ message: "Failed to initialize payment order" });
  }
};

/**
 * @desc    Step 2: Verify Payment Signature
 * @route   POST /api/payments/verify-payment
 */
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Fraudulent signature detected" });
    }

    const transaction = await Transaction.findOneAndUpdate(
      { orderId: razorpay_order_id, status: 'pending' },
      { 
        paymentId: razorpay_payment_id, 
        signature: razorpay_signature,
        status: 'paid', 
        paidAt: new Date(),
        verifiedBy: 'app_client'
      },
      { new: true }
    );

    res.status(200).json({ success: true, transaction });
  } catch (error) {
    console.error("❌ Verification Error:", error);
    res.status(500).json({ message: "Server error during payment verification" });
  }
};

/**
 * @desc    Step 3: Webhook (Fallback for network interruptions)
 * @route   POST /api/payments/webhook
 */
exports.handleWebhook = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET; 
  const signature = req.headers['x-razorpay-signature'];

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== expectedSignature) return res.status(400).send('Invalid');

    if (req.body.event === 'payment.captured' || req.body.event === 'order.paid') {
      const entity = req.body.payload.payment.entity;
      await Transaction.findOneAndUpdate(
        { orderId: entity.order_id, status: 'pending' },
        { paymentId: entity.id, status: 'paid', paidAt: new Date(), verifiedBy: 'webhook' }
      );
    }
    res.status(200).send('OK');
  } catch (error) {
    res.status(500).send('Error');
  }
};