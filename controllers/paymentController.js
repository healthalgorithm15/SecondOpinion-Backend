const crypto = require('crypto');
const Razorpay = require('razorpay');
const Transaction = require('../models/Transaction');
const ReviewCase = require('../models/ReviewCase'); 
const mongoose = require('mongoose');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const SCAN_PRICE_INR = 500;

exports.createOrder = async (req, res) => {
  try {
    const { scanId, patientId } = req.body;
    if (!patientId) return res.status(400).json({ message: "Patient ID is required" });

    const pId = new mongoose.Types.ObjectId(patientId);
    const normalizedScanId = (scanId === 'new_scan' || !scanId) ? null : scanId;

    // 🛡️ IDEMPOTENCY GUARD
    // FIX: Using patientId (matching schema)
    const existingUnusedCredit = await Transaction.findOne({
      patientId: pId,
      status: 'paid',
      scanId: null 
    });

    if (existingUnusedCredit) {
      return res.status(400).json({ 
        success: false, 
        message: "You already have an unused credit. Please proceed to upload reports.",
        code: "UNUSED_CREDIT_EXISTS"
      });
    }

    const existingPending = await Transaction.findOne({
      patientId: pId,
      status: 'pending',
      createdAt: { $gt: new Date(Date.now() - 15 * 60 * 1000) }
    });

    if (existingPending) {
      try {
        const order = await razorpay.orders.fetch(existingPending.orderId);
        return res.status(200).json(order);
      } catch (e) {
        existingPending.status = 'failed';
        await existingPending.save();
      }
    }

    const options = {
      amount: Math.floor(SCAN_PRICE_INR * 100),
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
      notes: { patientId: patientId.toString() }
    };

    const order = await razorpay.orders.create(options);

    await Transaction.create({
      patientId: pId, 
      scanId: normalizedScanId,
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

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Invalid signature" });
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

    if (!transaction) {
      const alreadyPaid = await Transaction.findOne({ orderId: razorpay_order_id, status: 'paid' });
      if (alreadyPaid) return res.status(200).json({ success: true, transaction: alreadyPaid });
      return res.status(404).json({ message: "Transaction record not found" });
    }

    if (transaction.scanId && mongoose.Types.ObjectId.isValid(transaction.scanId)) {
      await ReviewCase.findByIdAndUpdate(transaction.scanId, { status: 'AI_PROCESSING' });
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
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(req.body));
    const expectedSignature = hmac.digest('hex');

    if (signature !== expectedSignature) return res.status(400).send('Invalid Signature');

    const { event, payload } = req.body;
    if (event === 'payment.captured' || event === 'order.paid') {
      const entity = payload.payment ? payload.payment.entity : payload.order.entity;
      const orderId = entity.order_id || entity.id;

      const transaction = await Transaction.findOneAndUpdate(
        { orderId: orderId, status: 'pending' },
        { paymentId: entity.id, status: 'paid', paidAt: new Date(), verifiedBy: 'webhook' },
        { new: true }
      );

      if (transaction && transaction.scanId && mongoose.Types.ObjectId.isValid(transaction.scanId)) {
        await ReviewCase.findByIdAndUpdate(transaction.scanId, { status: 'AI_PROCESSING' });
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    res.status(500).send('Error');
  }
};