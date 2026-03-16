const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  // Link to the user who is paying
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Link to the specific medical scan being analyzed
  // 🟢 FIXED: Removed required: true to allow "new_scan" cases to be stored as null
  scanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Scan' },
  
  // Gateway Details
  orderId: { type: String, required: true, unique: true },
  paymentId: { type: String }, 
  signature: { type: String }, 
  
  // Status Tracking
  amount: { type: Number, required: true }, 
  status: { 
    type: String, 
    enum: ['pending', 'paid', 'failed', 'refunded'], 
    default: 'pending' 
  },

  // 🟢 ADDED: Tracking source of verification
  verifiedBy: { type: String, enum: ['app_client', 'webhook_server'] },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  paidAt: { type: Date }
});

module.exports = mongoose.model('Transaction', TransactionSchema);