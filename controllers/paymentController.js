const crypto = require('crypto');
const Razorpay = require('razorpay');
const Transaction = require('../models/Transaction');
const Scan = require('../models/Scan'); // Ensure this model exists to update status

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const SCAN_PRICE_INR = 500;

exports.createOrder = async (req, res) => {
  try {
    const { scanId, patientId } = req.body;

    if (!patientId) return res.status(400).json({ message: "Patient ID is required" });

    const options = {
      amount: Math.floor(SCAN_PRICE_INR * 100),
      currency: "INR",
      receipt: `rcpt_${scanId || 'new'}_${Date.now()}`,
      notes: { patientId, scanId: scanId || '' }
    };

    const order = await razorpay.orders.create(options);

    await Transaction.create({
      patientId,
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

exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // 1. Signature Verification
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    // 2. Atomic Update - Prevents race conditions with Webhook
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
      // Check if it was already marked paid by the Webhook
      const alreadyPaid = await Transaction.findOne({ orderId: razorpay_order_id, status: 'paid' });
      if (alreadyPaid) return res.status(200).json({ success: true, transaction: alreadyPaid });
      return res.status(404).json({ message: "Transaction record not found" });
    }

    // 3. Scan Model Hook - Unlock the record for AI processing
    if (transaction.scanId) {
      await Scan.findByIdAndUpdate(transaction.scanId, { 
        isPaid: true, 
        status: 'AI_PROCESSING' // This triggers the Stepper to move forward
      });
    }

    res.status(200).json({ success: true, transaction });
  } catch (error) {
    console.error("❌ Verification Error:", error);
    res.status(500).json({ message: "Server error during verification" });
  }
};

exports.handleWebhook = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];

  try {
    // Note: In production, use the raw request body buffer for signature verification
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== expectedSignature) return res.status(400).send('Invalid');

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

      // Webhook fallback: update Scan model if app client verification failed or was slow
      if (transaction && transaction.scanId) {
        await Scan.findByIdAndUpdate(transaction.scanId, { 
          isPaid: true, 
          status: 'AI_PROCESSING' 
        });
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).send('Error');
  }
};