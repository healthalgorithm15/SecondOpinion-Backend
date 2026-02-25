const ReviewCase = require('../models/ReviewCase');
const MedicalRecord = require('../models/MedicalRecord');

/**
 * @desc    Get details for a specific case
 * @route   GET /api/doctor/case/:caseId
 * @access  Private (Doctor Only)
 */
exports.getCaseById = async (req, res) => {
  try {
    // Populate patient info and original records so the doctor can see the files
    const caseData = await ReviewCase.findById(req.params.caseId)
      .populate('patientId', 'name age gender')
      .populate('recordIds') 
      .lean();

    if (!caseData) {
      return res.status(404).json({ success: false, message: "Case not found." });
    }

    res.status(200).json({
      success: true,
      data: caseData
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get all cases awaiting specialist review
 * @route   GET /api/doctor/pending-cases
 */
exports.getPendingCases = async (req, res) => {
  try {
    const cases = await ReviewCase.find({ status: 'PENDING_DOCTOR' })
      .populate('patientId', 'name age gender') 
      .sort({ 'aiAnalysis.riskLevel': -1, createdAt: 1 })
      .lean();

    res.status(200).json({
      success: true,
      count: cases.length,
      data: cases
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Submit final medical opinion and close the case
 * @route   POST /api/doctor/submit-opinion
 */
exports.submitOpinion = async (req, res) => {
  try {
    const { caseId, diagnosis, summary, finalVerdict, recommendations } = req.body;

    // ✅ Flexibility: Accept both frontend names (diagnosis) and backend names (finalVerdict)
    const verdictValue = finalVerdict || diagnosis;
    const notesValue = recommendations || summary;

    if (!verdictValue || !notesValue) {
      return res.status(400).json({ 
        success: false, 
        message: "Please provide both a final verdict and clinical recommendations." 
      });
    }

    // 1. Update the Case with Doctor's findings
    const updatedCase = await ReviewCase.findByIdAndUpdate(
      caseId,
      {
        doctorId: req.user._id, 
        doctorOpinion: {
          finalVerdict: verdictValue,
          recommendations: notesValue,
          reviewedAt: new Date()
        },
        status: 'COMPLETED' // Changes status so patient can see it
      },
      { new: true }
    );

    if (!updatedCase) {
      return res.status(404).json({ success: false, message: "Case not found." });
    }

    // 2. Mark associated records as COMPLETED so they stop showing as 'pending'
    await MedicalRecord.updateMany(
      { _id: { $in: updatedCase.recordIds } },
      { $set: { status: 'COMPLETED' } }
    );

    res.status(200).json({ 
      success: true, 
      message: "Medical opinion submitted. The patient has been notified." 
    });

  } catch (error) {
    console.error("Submit Opinion Error:", error);
    res.status(500).json({ success: false, message: "Server error during submission." });
  }
};