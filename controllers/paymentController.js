const crypto = require('crypto');
const Razorpay = require('razorpay');
const Transaction = require('../models/Transaction');

console.log("Checking Keys:", process.env.RAZORPAY_KEY_ID);
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// SECURITY: Define the source of truth for prices on the SERVER
const SCAN_PRICE_INR = 500; 

/**
 * Create Order - Securely initializes payment
 */
exports.createOrder = async (req, res) => {
  const { scanId, patientId } = req.body; 

  try {
    const options = {
      amount: SCAN_PRICE_INR * 100, // Hardcoded on server for safety
      currency: "INR",
      receipt: `rcpt_${scanId}_${Date.now()}`,
      notes: { patientId, scanId } 
    };

    const order = await razorpay.orders.create(options);

    /**
     * FIX: Handle "new_scan" string.
     * Mongoose expects an ObjectId for scanId. If the user is starting a 
     * fresh analysis, we set scanId to null so the database doesn't crash.
     */
    const safeScanId = (scanId === 'new_scan' || !scanId) ? null : scanId;

    // Initial status 'pending' ensures we know who tried to pay
    await Transaction.create({
      patientId,
      scanId: safeScanId, // Use the safe version here
      orderId: order.id,
      amount: SCAN_PRICE_INR,
      status: 'pending'
    });

    res.status(200).json(order);
  } catch (error) {
    console.error("Order Creation Error:", error);
    res.status(500).json({ message: "Security Error: Order initialization failed" });
  }
};

/**
 * Verify Payment - Called by the Mobile App after payment
 */
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // SECURITY: Re-calculate HMAC Signature on server
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Fraudulent signature" });
    }

    // Update status only if it's currently 'pending'
    const transaction = await Transaction.findOneAndUpdate(
      { orderId: razorpay_order_id, status: 'pending' },
      { 
        paymentId: razorpay_payment_id, 
        status: 'paid', 
        paidAt: new Date(),
        verifiedBy: 'app_client'
      },
      { new: true }
    );

    res.status(200).json({ success: true, transaction });
  } catch (error) {
    res.status(500).json({ message: "Server error during verification" });
  }
};

/**
 * Webhook - The Safety Net for app crashes or internet drops
 */
exports.handleWebhook = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET; 
  const signature = req.headers['x-razorpay-signature'];

  try {
    // Note: Use raw body for webhook verification if possible 
    // depending on your express middleware setup
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).send('Invalid signature');
    }

    // Process payment success events
    if (req.body.event === 'payment.captured' || req.body.event === 'order.paid') {
      const entity = req.body.payload.payment.entity;
      
      await Transaction.findOneAndUpdate(
        { orderId: entity.order_id, status: 'pending' },
        { 
          paymentId: entity.id, 
          status: 'paid', 
          paidAt: new Date(),
          verifiedBy: 'webhook_server' 
        }
      );
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).send('Internal Server Error');
  }
};