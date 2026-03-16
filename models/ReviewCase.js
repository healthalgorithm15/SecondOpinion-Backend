const mongoose = require('mongoose');

const ReviewCaseSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, 
  recordIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord', required: true }],

  status: { 
    type: String, 
    enum: ['AI_PROCESSING', 'PENDING_DOCTOR', 'COMPLETED', 'CANCELLED'],
    default: 'AI_PROCESSING' 
  },

  aiAnalysis: {
    summary: String,
    riskLevel: { 
      type: String, 
      enum: ['Low', 'Medium', 'High', 'Unknown'], 
      default: 'Unknown' 
    }, 
    extractedMarkers: [String],
    // 🟢 FIXED: Match field name used in aiService.js (analyzedAt)
    analyzedAt: { type: Date, default: Date.now },
    // 🟢 ADDED: Useful for tracking which model gave which result
    modelVersion: String,
    // 🟢 ADDED: To store failure reasons if AI fails
    errorLog: String 
  },
  
  priority: { 
    type: String, 
    enum: ['Normal', 'High'], 
    default: 'Normal' 
  },
  
  doctorOpinion: {
    finalVerdict: String,
    recommendations: String,
    reviewedAt: Date
  }
}, { timestamps: true }); // Automatically handles createdAt and updatedAt

module.exports = mongoose.model('ReviewCase', ReviewCaseSchema);