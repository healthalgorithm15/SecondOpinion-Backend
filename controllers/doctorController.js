const ReviewCase = require('../models/ReviewCase');
const MedicalRecord = require('../models/MedicalRecord');
const mongoose = require('mongoose');

/**
 * 🔔 IMPORT CENTRALIZED NOTIFICATION HELPER
 * This ensures that when a doctor submits an opinion, 
 * the high-priority push notification logic is triggered.
 */
const caseController = require('./caseController'); 

/**
 * @desc    Get all cases awaiting specialist review
 * @route   GET /api/doctor/pending-cases
 * @access  Private (Doctor Only)
 */
exports.getPendingCases = async (req, res) => {
  try {
    const cases = await ReviewCase.find({ status: 'PENDING_DOCTOR' })
      .select('status aiAnalysis createdAt patientId recordIds') 
      .populate('patientId', 'name age gender') 
      .populate({ 
        path: 'recordIds', 
        select: 'contentType title' 
      }) 
      .sort({ 'aiAnalysis.riskLevel': -1, createdAt: 1 }) 
      .lean();

    // Remove any null records in case a file was deleted but the reference remained
    const sanitizedCases = cases.map(c => ({
      ...c,
      recordIds: (c.recordIds || []).filter(r => r !== null)
    }));

    res.status(200).json({ 
      success: true, 
      count: sanitizedCases.length, 
      data: sanitizedCases 
    });
  } catch (error) {
    console.error("❌ Fetch Pending Error:", error);
    res.status(500).json({ success: false, message: "Error fetching pending cases." });
  }
};

/**
 * @desc    Get details for a specific case including all medical records
 * @route   GET /api/doctor/case/:caseId
 */
exports.getCaseById = async (req, res) => {
  try {
    const caseData = await ReviewCase.findById(req.params.caseId)
      .populate('patientId', 'name age gender')
      .populate({ 
        path: 'recordIds', 
        select: 'title category reportDate fileType contentType' 
      }) 
      .lean();

    if (!caseData) {
      return res.status(404).json({ success: false, message: "Case not found." });
    }

    res.status(200).json({ success: true, data: caseData });
  } catch (error) {
    console.error("❌ Get Case Detail Error:", error);
    res.status(500).json({ success: false, message: "Error loading case details." });
  }
};

/**
 * @desc    Submit final medical opinion and close the case (Atomic Transaction)
 * @route   POST /api/doctor/submit-opinion
 */
exports.submitOpinion = async (req, res) => {
  const { caseId, diagnosis, summary, finalVerdict, recommendations } = req.body;

  // Support both legacy naming and updated naming conventions
  const verdictValue = (finalVerdict || diagnosis)?.trim();
  const notesValue = (recommendations || summary)?.trim();

  if (!verdictValue || !notesValue) {
    return res.status(400).json({ 
      success: false, 
      message: "Both a final verdict and clinical recommendations are required." 
    });
  }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const updatedCase = await ReviewCase.findOneAndUpdate(
        { _id: caseId, status: { $ne: 'COMPLETED' } },
        {
          doctorId: req.user._id, 
          doctorOpinion: { 
            finalVerdict: verdictValue, 
            recommendations: notesValue, 
            reviewedAt: new Date() 
          },
          status: 'COMPLETED'
        },
        { new: true, session }
      );

      if (!updatedCase) {
        throw new Error("CASE_NOT_FOUND_OR_FINALIZED");
      }

      // Mark all associated records as completed/archived
      await MedicalRecord.updateMany(
        { _id: { $in: updatedCase.recordIds } },
        { $set: { status: 'COMPLETED' } },
        { session }
      );
    });

    /**
     * 🏆 TRIGGER PATIENT NOTIFICATION
     * Using the high-priority helper from caseController to wake the patient's device.
     */
    caseController.notifyPatientReportReady(caseId); 

    res.status(200).json({ 
      success: true, 
      message: "Medical opinion submitted successfully. The patient has been notified." 
    });

  } catch (error) {
    console.error("🔥 Submit Opinion Error:", error);
    const isClientError = error.message === "CASE_NOT_FOUND_OR_FINALIZED";
    res.status(isClientError ? 400 : 500).json({ 
      success: false, 
      message: isClientError ? "Case not found or already completed." : "Server error during submission." 
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get all cases completed by the current doctor (Paginated)
 * @route   GET /api/doctor/history
 */
exports.getDoctorHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { 
      doctorId: req.user._id, 
      status: 'COMPLETED' 
    };

    const cases = await ReviewCase.find(query)
      .select('patientId doctorOpinion updatedAt status')
      .populate('patientId', 'name')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await ReviewCase.countDocuments(query);

    res.status(200).json({ 
      success: true, 
      data: cases, 
      pagination: { 
        total, 
        page, 
        pages: Math.ceil(total / limit) 
      }
    });
  } catch (error) {
    console.error("❌ History Error:", error);
    res.status(500).json({ success: false, message: "Error fetching clinical history." });
  }
};