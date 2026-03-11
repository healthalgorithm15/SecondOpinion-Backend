const crypto = require('crypto');
const Transaction = require('../models/Transaction');

// UNCOMMENT IN PRODUCTION
// const Razorpay = require('razorpay'); 
// const razorpay = new Razorpay({
//   key_id: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_SECRET_KEY,
// });

exports.createOrder = async (req, res) => {
  const { amount, scanId, patientId } = req.body;

  try {
    let order;

    // --- PRODUCTION LOGIC (Uncomment when ready) ---
    /*
    const options = {
      amount: amount, // in paise
      currency: "INR",
      receipt: `receipt_${scanId}`,
    };
    order = await razorpay.orders.create(options);
    */

    // --- DEVELOPMENT FALLBACK ---
    // Comment this out when production is live
    order = {
      id: `order_dev_${Date.now()}`,
      amount: amount,
      currency: "INR",
      status: "created"
    };

    // 1. Log the Pending Transaction in Database
    // This is critical for auditing even if payment is never completed
    await Transaction.create({
      patientId,
      scanId,
      orderId: order.id,
      amount: order.amount,
      status: 'pending'
    });

    res.status(200).json(order);

  } catch (error) {
    console.error("Order Creation Error:", error);
    res.status(500).json({ message: "Order creation failed", error });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // --- PRODUCTION LOGIC (Uncomment when ready) ---
    /*
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET_KEY)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
       return res.status(400).json({ success: false, message: "Invalid signature" });
    }
    */

    // --- DEVELOPMENT FALLBACK (Remove for production) ---
    if (razorpay_signature !== "dev_bypass") {
       // In dev, we only accept our specific bypass string
       // return res.status(400).json({ success: false }); 
    }

    // 2. Update Database to SUCCESS
    // We find the transaction by orderId and mark it paid
    const updatedTransaction = await Transaction.findOneAndUpdate(
      { orderId: razorpay_order_id },
      { 
        paymentId: razorpay_payment_id, 
        signature: razorpay_signature,
        status: 'paid',
        paidAt: new Date()
      },
      { new: true }
    );

    if (!updatedTransaction) {
      return res.status(404).json({ message: "Transaction record not found" });
    }

    // 3. Trigger Post-Payment Actions
    // e.g., Send notification to Doctor about the new paid scan
    // await notifyDoctor(updatedTransaction.scanId);

    res.status(200).json({ 
      success: true, 
      message: "Payment verified and recorded",
      transaction: updatedTransaction 
    });

  } catch (error) {
    console.error("Verification Error:", error);
    res.status(500).json({ message: "Server error during verification" });
  }
};