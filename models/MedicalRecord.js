const mongoose = require('mongoose');

const MedicalRecordSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  category: { type: String, default: 'General' },
  reportDate: { type: String }, 
  fileType: { type: String, enum: ['pdf', 'image'] },
  
  // For AWS Production
  fileUrl: { type: String }, 
  
  // For Local Development (Storing bits in DB)
  fileData: { type: Buffer },
  contentType: { type: String }, // e.g., 'application/pdf'
}, { timestamps: true });

module.exports = mongoose.model('MedicalRecord', MedicalRecordSchema);