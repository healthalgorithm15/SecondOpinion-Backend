const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  // Link to the user who is paying
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Link to the specific medical scan being analyzed
  scanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Scan', required: true },
  
  // Gateway Details
  orderId: { type: String, required: true, unique: true },
  paymentId: { type: String }, // Filled after successful payment
  signature: { type: String }, // Filled after successful payment
  
  // Status Tracking
  amount: { type: Number, required: true }, // Store in paise (e.g., 50000)
  status: { 
    type: String, 
    enum: ['pending', 'paid', 'failed', 'refunded'], 
    default: 'pending' 
  },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  paidAt: { type: Date }
});

module.exports = mongoose.model('Transaction', TransactionSchema);