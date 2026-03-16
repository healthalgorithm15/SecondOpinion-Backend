const crypto = require('crypto');
const Razorpay = require('razorpay');
const Transaction = require('../models/Transaction');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const SCAN_PRICE_INR = 500; 

/**
 * 1. Create Order
 */
exports.createOrder = async (req, res) => {
  const { scanId, patientId } = req.body; 

  try {
    const options = {
      amount: SCAN_PRICE_INR * 100, 
      currency: "INR",
      receipt: `rcpt_${scanId}_${Date.now()}`,
      notes: { patientId, scanId } 
    };

    const order = await razorpay.orders.create(options);

    // Convert "new_scan" string to null for Mongoose ObjectId compatibility
   // Inside your createOrder function:
const { scanId, patientId } = req.body;

// 1. Sanitize the scanId for Mongoose
// If scanId is the string "new_scan", we must pass null to the model
const safeScanId = (scanId === 'new_scan' || !scanId) ? null : scanId;

// 2. Create the transaction record
await Transaction.create({
  patientId,
  scanId: safeScanId, // This now works because 'required: true' is gone
  orderId: order.id,
  amount: SCAN_PRICE_INR,
  status: 'pending'
});
    res.status(200).json(order);
  } catch (error) {
    console.error("Order Creation Error:", error);
    res.status(500).json({ message: "Order initialization failed" });
  }
};

/**
 * 2. Verify Payment
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
      return res.status(400).json({ success: false, message: "Fraudulent signature" });
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
    console.error("Verification Error:", error);
    res.status(500).json({ message: "Server error during verification" });
  }
};

/**
 * 3. Webhook
 */
exports.handleWebhook = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET; 
  const signature = req.headers['x-razorpay-signature'];

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).send('Invalid signature');
    }

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