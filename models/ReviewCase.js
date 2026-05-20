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
    enum: [
      'AI_PROCESSING', 
      'PENDING',
      'UNASSIGNED',          // Waiting for CMO to assign
      'PENDING_DOCTOR',      // Assigned to a Specialist
      'PENDING_CMO_APPROVAL', // Specialist finished, waiting for CMO sign-off
      'COMPLETED',           // CMO approved, finalized, patient can view complete package
      'CANCELLED'
    ],
    default: 'AI_PROCESSING',
    index: true
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
    analyzedAt: { type: Date, default: Date.now },
    modelVersion: String,
    errorLog: String 
  },
  
  priority: { 
    type: String, 
    enum: ['Normal', 'High'], 
    default: 'Normal',
    index: true
  },
  
  // 👨‍⚕️ Core layer for Specialist clinical insights
  doctorOpinion: {
    specialistId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // 🟢 FIXED: Keeps audit log of original author
    finalVerdict: String,
    recommendations: String,
    reviewedAt: Date
  },

  // 👑 Dedicated isolation layer for Chief Medical Officer authentication
  cmoOpinion: {
    updatedVerdict: String,
    updatedRecommendations: String,
    cmoPrivateNote: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // 🟢 CLEANED: Consistently maps to active user session
    approvedAt: { type: Date }
  }

}, { timestamps: true }); // Automatically handles createdAt and updatedAt

// Compound indexing to optimize real-time status fetching pipelines
ReviewCaseSchema.index({ status: 1, assignedTo: 1 });

module.exports = mongoose.model('ReviewCase', ReviewCaseSchema);