const ReviewCase = require('../models/ReviewCase');
const MedicalRecord = require('../models/MedicalRecord');
const { Expo } = require('expo-server-sdk');
const expo = new Expo();
const mongoose = require('mongoose');


/**
 * @desc    Get all cases awaiting specialist review
 * @route   GET /api/doctor/pending-cases
 */
exports.getPendingCases = async (req, res) => {
  try {
    const cases = await ReviewCase.find({ status: 'PENDING_DOCTOR' })
      .select('status aiAnalysis createdAt patientId recordIds') 
      .populate('patientId', 'name age gender') 
      // 🚀 Optimized populate to ensure contentType is always sent for UI icons
      .populate({
        path: 'recordIds',
        select: 'contentType title'
      }) 
      .sort({ 'aiAnalysis.riskLevel': -1, createdAt: 1 }) 
      .lean();

    // Filter out any potential nulls if a medical record was deleted but case reference remained
    const sanitizedCases = cases.map(c => ({
      ...c,
      recordIds: c.recordIds.filter(r => r !== null)
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
 * @desc    Get details for a specific case
 */
exports.getCaseById = async (req, res) => {
  try {
    const caseData = await ReviewCase.findById(req.params.caseId)
      .populate('patientId', 'name age gender')
      .populate({
        path: 'recordIds',
        // 🛡️ Added 'fileSize' or other metadata if needed for the doctor's info
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

  const verdictValue = (finalVerdict || diagnosis)?.trim();
  const notesValue = (recommendations || summary)?.trim();

  if (!verdictValue || !notesValue) {
    return res.status(400).json({ 
      success: false, 
      message: "Please provide both a final verdict and clinical recommendations." 
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

      await MedicalRecord.updateMany(
        { _id: { $in: updatedCase.recordIds } },
        { $set: { status: 'COMPLETED' } },
        { session }
      );
    });

    // 🏆 THE LOOP CLOSER 
    // We call this AFTER the transaction is successful
    notifyPatientReportReady(caseId); 

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

/**
 * 🔵 INTERNAL HELPER: Notify Patient
 */
const notifyPatientReportReady = async (caseId) => {
  try {
    // Populate patientId to get the pushToken
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId', 'pushToken name');
    const patient = updatedCase.patientId;

    if (!patient || !patient.pushToken || !Expo.isExpoPushToken(patient.pushToken)) {
      console.log("No valid push token for patient. skipping notification.");
      return;
    }

    const message = {
      to: patient.pushToken,
      sound: 'default',
      title: 'Medical Report Ready! ✅',
      body: `Hi ${patient.name.split(' ')[0]}, your specialist review is now available.`,
      data: { caseId: updatedCase._id, screen: 'case-summary' },
      priority: 'high'
    };

    let chunks = expo.chunkPushNotifications([message]);
    for (let chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
    console.log(`✅ Notification sent to patient: ${patient.name}`);
  } catch (error) {
    console.error("❌ Patient Notification Error:", error);
  }
};