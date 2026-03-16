const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // 🟢 Fixed: Removed required: true to allow null for "new_scan"
  scanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Scan' },
  
  orderId: { type: String, required: true, unique: true },
  paymentId: { type: String }, 
  signature: { type: String }, 
  amount: { type: Number, required: true }, 
  status: { 
    type: String, 
    enum: ['pending', 'paid', 'failed', 'refunded'], 
    default: 'pending' 
  },
  verifiedBy: { type: String, enum: ['app_client', 'webhook_server'] },
  createdAt: { type: Date, default: Date.now },
  paidAt: { type: Date }
});

module.exports = mongoose.model('Transaction', TransactionSchema);