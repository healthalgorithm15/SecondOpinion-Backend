const mongoose = require('mongoose');

const ReviewCaseSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, 
  recordIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord', required: true }],
  patientNote: {
        type: String,
        trim: true,
        maxlength: 2000 // Limit to ~300-400 words
    },

  assignedTo: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    default: null, // Initially unassigned
    index: true 
  },

  status: { 
    type: String, 
    enum: ['AI_PROCESSING', 
      'PENDING',
      'UNASSIGNED',          // Waiting for CMO to assign
      'PENDING_DOCTOR',      // Assigned to a Specialist
      'PENDING_CMO_APPROVAL', // Specialist finished, waiting for CMO sign-off 🟢 NEW
      'COMPLETED',           // CMO approved, patient can see it
      'CANCELLED'],
    default: 'AI_PROCESSING' 
  },

  assignmentHistory: [{
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date, default: Date.now },
    note: String
  }],

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
    reviewedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    cmoPrivateNote: String
  }
}, { timestamps: true }); // Automatically handles createdAt and updatedAt

module.exports = mongoose.model('ReviewCase', ReviewCaseSchema);