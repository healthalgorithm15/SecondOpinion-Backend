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
    // aiService.analyzeReports must call notifyDoctorCaseReady when finished
    aiService.analyzeReports(caseId);

    res.status(200).json({ success: true, message: "Analysis started" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 🟢 NOTIFY DOCTOR: AI Analysis Complete
 * Optimized for FCM V1 Background Delivery
 */
exports.notifyDoctorCaseReady = async (caseId) => {
  try {
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId', 'name');
    if (!updatedCase) return;
    
    // 1. Socket Emit (Real-time dashboard)
    if (global.io) {
      global.io.to('doctor').emit('case_ready_for_review', {
        caseId: updatedCase._id,
        patientName: updatedCase.patientId?.name
      });
    }

    // 2. Push Notification (Background delivery)
    const doctors = await User.find({ role: 'doctor', pushToken: { $ne: null } });
    let messages = [];

    for (let doc of doctors) {
      if (!Expo.isExpoPushToken(doc.pushToken)) continue;
      messages.push({
        to: doc.pushToken,
        sound: 'default',
        title: 'Action Required: New Case 🩺',
        body: `AI analysis complete for ${updatedCase.patientId?.name}. Ready for review.`,
        data: { caseId: updatedCase._id, role: 'doctor' },
        priority: 'high', // Wakes up device
        channelId: 'default'
      });
    }

    if (messages.length > 0) {
      let chunks = expo.chunkPushNotifications(messages);
      for (let chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    }
    console.log(`✅ Doctor notifications sent for Case: ${caseId}`);
  } catch (error) {
    console.error("Notification Error:", error);
  }
};

/**
 * 🔵 NOTIFY PATIENT: Specialist Review Complete
 */
exports.notifyPatientReportReady = async (caseId) => {
  try {
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId', 'pushToken name');
    const patient = updatedCase.patientId;

    if (!patient || !patient.pushToken || !Expo.isExpoPushToken(patient.pushToken)) {
      console.log("No valid push token found for patient.");
      return;
    }

    const message = {
      to: patient.pushToken,
      sound: 'default',
      title: 'Medical Report Ready! ✅',
      body: `Hi ${patient.name.split(' ')[0]}, your specialist review is now available for viewing.`,
      data: { caseId: updatedCase._id, screen: 'case-summary' },
      priority: 'high',
      channelId: 'default'
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