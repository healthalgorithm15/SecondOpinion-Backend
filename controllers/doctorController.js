const ReviewCase = require('../models/ReviewCase');
const MedicalRecord = require('../models/MedicalRecord');
const mongoose = require('mongoose');

/**
 * 🔔 IMPORT CENTRALIZED NOTIFICATION HELPER
 */
const caseController = require('./caseController'); 

/**
 * @desc    Get all cases awaiting specialist review
 * @route   GET /api/doctor/pending-cases
 * @access  Private (Doctor & CMO)
 */
exports.getPendingCases = async (req, res) => {
  try {
    // 🟢 DYNAMIC QUERY: CMO sees the global queue, Doctor sees their assignments
    let query = { status: 'PENDING_DOCTOR' };

    if (req.user.role === 'doctor') {
      query.assignedTo = req.user._id;
    } 
    // CMO role does not add the assignedTo filter, allowing a full view

    const cases = await ReviewCase.find(query)
      .select('status aiAnalysis createdAt patientId recordIds assignedTo') 
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
 * @access  Private (Assigned Doctor, CMO, or Admin)
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

    // 🛡️ SECURITY: Verify access permissions
    const isAssigned = caseData.assignedTo?.toString() === req.user._id.toString();
    const isPrivileged = ['admin', 'cmo'].includes(req.user.role);

    if (!isAssigned && !isPrivileged) {
      return res.status(403).json({ success: false, message: "Unauthorized access to this case." });
    }

    res.status(200).json({ success: true, data: caseData });
  } catch (error) {
    console.error("❌ Get Case Detail Error:", error);
    res.status(500).json({ success: false, message: "Error loading case details." });
  }
};

/**
 * @desc    Submit medical opinion for CMO review (Atomic Transaction)
 * @route   POST /api/doctor/submit-opinion
 * @access  Private (Assigned Doctor Only)
 */
exports.submitOpinion = async (req, res) => {
  const { caseId, finalVerdict, recommendations } = req.body;
  const verdictValue = finalVerdict?.trim();
  const notesValue = recommendations?.trim();

  if (!verdictValue || !notesValue) {
    return res.status(400).json({ success: false, message: "Verdict and recommendations are required." });
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // 🛡️ SECURITY: Verify status AND that the submitter is the assigned doctor
      const updatedCase = await ReviewCase.findOneAndUpdate(
        { 
          _id: caseId, 
          status: 'PENDING_DOCTOR',
          assignedTo: req.user._id 
        },
        {
          doctorId: req.user._id, 
          doctorOpinion: { 
            finalVerdict: verdictValue, 
            recommendations: notesValue, 
            reviewedAt: new Date() 
          },
          status: 'PENDING_CMO_APPROVAL'
        },
        { new: true, session }
      );

      if (!updatedCase) throw new Error("CASE_NOT_FOUND_OR_UNAUTHORIZED");

      // Update associated records status
      await MedicalRecord.updateMany(
        { _id: { $in: updatedCase.recordIds } },
        { $set: { status: 'PENDING_APPROVAL' } }, 
        { session }
      );
    });

    // 🔔 Notify CMO that a specialist has finished their work
    caseController.notifyCMOReviewReady(caseId); 

    res.status(200).json({ 
      success: true, 
      message: "Opinion submitted to CMO for final review." 
    });

  } catch (error) {
    console.error("🔥 Submit Opinion Error:", error);
    const message = error.message === "CASE_NOT_FOUND_OR_UNAUTHORIZED" 
      ? "Case not found or you are not the assigned specialist." 
      : error.message;
    res.status(500).json({ success: false, message });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get clinical history (Paginated)
 * @route   GET /api/doctor/history
 * @access  Private (Doctor sees own, CMO sees all)
 */
exports.getDoctorHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 🟢 DYNAMIC QUERY: CMO sees full archive, Doctor sees their own completed cases
    let query = { status: 'COMPLETED' };
    
    if (req.user.role === 'doctor') {
      query.doctorId = req.user._id;
    }

    const cases = await ReviewCase.find(query)
      .select('patientId doctorOpinion updatedAt status doctorId')
      .populate('patientId', 'name')
      .populate('doctorId', 'name') // Allows CMO to see who performed the review
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

// controllers/doctorController.js

exports.getAllSpecialists = async (req, res) => {
  try {
    // Fetch only users with the 'doctor' role
    const doctors = await User.find({ role: 'doctor' })
      .select('name email specializations availability status')
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: doctors.length,
      data: doctors
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};