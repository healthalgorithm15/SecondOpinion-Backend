const crypto = require('crypto');
const Razorpay = require('razorpay');
const Transaction = require('../models/Transaction');
const ReviewCase = require('../models/ReviewCase'); // ✅ Corrected Model

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const SCAN_PRICE_INR = 500;

/**
 * 1. Create Order
 * Triggers when the user clicks 'Get Credit' or 'Pay'
 */
exports.createOrder = async (req, res) => {
  try {
    const { scanId, patientId } = req.body;

    if (!patientId) return res.status(400).json({ message: "Patient ID is required" });

    const options = {
      amount: Math.floor(SCAN_PRICE_INR * 100), // Razorpay expects paise
      currency: "INR",
      receipt: `rcpt_${scanId || 'new'}_${Date.now()}`,
      notes: { patientId, scanId: scanId || '' }
    };

    const order = await razorpay.orders.create(options);

    // Save transaction in pending state
    await Transaction.create({
      patientId,
      // If scanId is 'new_scan', it means they are buying a credit before uploading
      scanId: (scanId === 'new_scan' || !scanId) ? null : scanId,
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
 * 2. Verify Payment (App-side Handshake)
 * Triggers immediately after Razorpay UI closes successfully
 */
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Signature Verification
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    // Atomic Update to prevent race conditions with Webhook
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

    if (!transaction) {
      const alreadyPaid = await Transaction.findOne({ orderId: razorpay_order_id, status: 'paid' });
      if (alreadyPaid) return res.status(200).json({ success: true, transaction: alreadyPaid });
      return res.status(404).json({ message: "Transaction record not found" });
    }

    // ✅ ReviewCase Hook - Move to AI_PROCESSING state
    if (transaction.scanId) {
      await ReviewCase.findByIdAndUpdate(transaction.scanId, { 
        status: 'AI_PROCESSING' 
      });
    }

    res.status(200).json({ success: true, transaction });
  } catch (error) {
    console.error("❌ Verification Error:", error);
    res.status(500).json({ message: "Server error during verification" });
  }
};

/**
 * 3. Webhook (Server-to-Server Fallback)
 * Handles cases where user's app crashes or network drops after payment
 */
exports.handleWebhook = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];

  try {
    // Verification using the raw body (Standard for production)
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(req.body));
    const expectedSignature = hmac.digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).send('Invalid Signature');
    }

    const { event, payload } = req.body;

    if (event === 'payment.captured' || event === 'order.paid') {
      const entity = payload.payment ? payload.payment.entity : payload.order.entity;
      const orderId = entity.order_id || entity.id;

      const transaction = await Transaction.findOneAndUpdate(
        { orderId: orderId, status: 'pending' },
        { 
          paymentId: entity.id, 
          status: 'paid', 
          paidAt: new Date(), 
          verifiedBy: 'webhook' 
        },
        { new: true }
      );

      // Webhook fallback: update ReviewCase model
      if (transaction && transaction.scanId) {
        await ReviewCase.findByIdAndUpdate(transaction.scanId, { 
          status: 'AI_PROCESSING' 
        });
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error("❌ Webhook Error:", error);
    res.status(500).send('Error');
  }
};