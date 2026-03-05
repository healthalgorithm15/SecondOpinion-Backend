const User = require('../models/User');
const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

exports.startCaseAnalysis = async (req, res) => {
  try {
    const { caseId } = req.params;

    // 1. Instantly set status to PROCESSING
    await ReviewCase.findByIdAndUpdate(caseId, { status: 'PROCESSING' });

    // 2. 🚀 FIRE AND FORGET
    // Notice there is NO 'await' here. The AI starts in the background.
    aiService.analyzeReports(caseId);

    // 3. Respond to Mobile App immediately
    res.status(200).json({ success: true, message: "Analysis started" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 🟢 NEW HELPER: This logic should be called by your aiService 
 * or added here if you handle the status transition manually.
 */
exports.notifyDoctorCaseReady = async (caseId) => {
  try {
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId', 'name');
    
    // 🟢 1. Socket Emit (For doctors currently using the app)
    if (global.io) {
      global.io.to('doctor').emit('case_ready_for_review', {
        caseId: updatedCase._id,
        patientName: updatedCase.patientId?.name
      });
    }

    // 🟢 2. Push Notification (For doctors with the app closed)
    const doctors = await User.find({ role: 'doctor', pushToken: { $ne: null } });
    let messages = [];

    for (let doc of doctors) {
      if (!Expo.isExpoPushToken(doc.pushToken)) continue;
      messages.push({
        to: doc.pushToken,
        sound: 'default',
        title: 'Action Required: New Case 🩺',
        body: `AI analysis complete for ${updatedCase.patientId?.name}. Ready for your review.`,
        data: { caseId: updatedCase._id },
      });
    }

    if (messages.length > 0) {
      let chunks = expo.chunkPushNotifications(messages);
      for (let chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    }
  } catch (error) {
    console.error("Notification Error:", error);
  }
};

/**
 * 🔵 NEW HELPER: Notify Patient that Specialist Review is Complete
 * Call this inside the controller where the doctor saves the final verdict.
 */
exports.notifyPatientReportReady = async (caseId) => {
  try {
    // 1. Get the case and populate the patient's pushToken
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId');
    
    const patient = updatedCase.patientId;

    if (!patient || !patient.pushToken || !Expo.isExpoPushToken(patient.pushToken)) {
      console.log("No valid push token found for patient.");
      return;
    }

    // 2. Prepare the Message
    const message = {
      to: patient.pushToken,
      sound: 'default',
      title: 'Medical Report Ready! ✅',
      body: `Your specialist review for Case #${caseId.slice(-6).toUpperCase()} is now available for viewing.`,
      data: { 
        caseId: updatedCase._id, 
        screen: 'case-summary' // This tells the app where to go on tap
      },
      priority: 'high'
    };

    // 3. Send via Expo SDK
    let chunks = expo.chunkPushNotifications([message]);
    for (let chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }

    console.log(`✅ Notification sent to patient: ${patient.name}`);
  } catch (error) {
    console.error("❌ Patient Notification Error:", error);
  }
};