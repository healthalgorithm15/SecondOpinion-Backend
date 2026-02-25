const mongoose = require('mongoose');

const ReviewCaseSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, 
  recordIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord', required: true }],

  // 🟢 FIXED: Added 'AI_PROCESSING' to the enum to match the default and controller
  status: { 
    type: String, 
    enum: ['AI_PROCESSING', 'PENDING_DOCTOR', 'COMPLETED', 'CANCELLED'],
    default: 'AI_PROCESSING' 
  },

 aiAnalysis: {
    summary: String,
    riskLevel: { type: String, enum: ['Low', 'Medium', 'High', 'Unknown'] }, 
    extractedMarkers: [String], // 🟢 Changed from Object to Array of Strings
    processedAt: { type: Date, default: Date.now }
  },
  
  // 🟢 Add this for better Doctor Dashboard sorting
  priority: { 
    type: String, 
    enum: ['Normal', 'High'], 
    default: 'Normal' 
  },
  
  doctorOpinion: {
    finalVerdict: String,
    recommendations: String,
    reviewedAt: Date
  },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('ReviewCase', ReviewCaseSchema);