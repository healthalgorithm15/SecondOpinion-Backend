const ReviewCase = require('../models/ReviewCase');
const MedicalRecord = require('../models/MedicalRecord');
const mongoose = require('mongoose');

/**
 * @desc    Get all cases awaiting specialist review
 * @route   GET /api/doctor/pending-cases
 */
exports.getPendingCases = async (req, res) => {
  try {
    // 🛡️ Projection: Only fetch summary data for the queue to save RAM
    const cases = await ReviewCase.find({ status: 'PENDING_DOCTOR' })
      .select('status aiAnalysis createdAt patientId') 
      .populate('patientId', 'name age gender') 
      .sort({ 'aiAnalysis.riskLevel': -1, createdAt: 1 }) // High risk prioritized
      .lean();

    res.status(200).json({
      success: true,
      count: cases.length,
      data: cases
    });
  } catch (error) {
    console.error("❌ Fetch Pending Error:", error);
    res.status(500).json({ success: false, message: "Error fetching pending cases." });
  }
};

/**
 * @desc    Get details for a specific case
 * @route   GET /api/doctor/case/:caseId
 */
exports.getCaseById = async (req, res) => {
  try {
    const caseData = await ReviewCase.findById(req.params.caseId)
      .populate('patientId', 'name age gender')
      // 🛡️ Security: select() avoids loading massive fileData buffers into RAM here
      .populate({
        path: 'recordIds',
        select: 'title category reportDate fileType contentType' 
      }) 
      .lean();

    if (!caseData) {
      return res.status(404).json({ success: false, message: "Case not found." });
    }

    res.status(200).json({
      success: true,
      data: caseData
    });
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

  // 1. Flexibility Logic for different frontend state naming
  const verdictValue = (finalVerdict || diagnosis)?.trim();
  const notesValue = (recommendations || summary)?.trim();

  if (!verdictValue || !notesValue) {
    return res.status(400).json({ 
      success: false, 
      message: "Please provide both a final verdict and clinical recommendations." 
    });
  }

  // 🟢 PRODUCTION ATOMIC TRANSACTION
  // Requires MongoDB Atlas or Local Replica Set
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // 2. Update the Case with Doctor's findings
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

      // 3. Mark associated records as COMPLETED in bulk
      await MedicalRecord.updateMany(
        { _id: { $in: updatedCase.recordIds } },
        { $set: { status: 'COMPLETED' } },
        { session }
      );
    });

    res.status(200).json({ 
      success: true, 
      message: "Medical opinion submitted. The patient has been notified." 
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
 * @desc    Get all cases completed by the doctor (Paginated)
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
      .select('patientId doctorOpinion updatedAt status') // 🛡️ Projections for speed
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
    res.status(500).json({ success: false, message: "Error fetching history." });
  }
};