const User = require('../models/User');
const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

/**
 * 🟡 START ANALYSIS
 * Responds to the client immediately while AI works in background.
 */
exports.startCaseAnalysis = async (req, res) => {
  try {
    const { caseId } = req.params;

    // 1. Update status to PROCESSING
    await ReviewCase.findByIdAndUpdate(caseId, { status: 'PROCESSING' });

    // 2. 🚀 ASYNC EXECUTION
    // This runs in background. Ensure aiService.analyzeReports is robust!
    aiService.analyzeReports(caseId).catch(err => {
        console.error(`CRITICAL: Background AI Analysis failed for ${caseId}:`, err);
    });

    res.status(200).json({ success: true, message: "Analysis started" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 🟢 NOTIFY DOCTOR: AI Analysis Complete
 */
exports.notifyDoctorCaseReady = async (caseId) => {
  try {
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId', 'name');
    if (!updatedCase) return;
    
    // 1. Socket Emit (Dashboard sync)
    if (global.io) {
      global.io.to('doctor').emit('case_ready_for_review', {
        caseId: updatedCase._id,
        patientName: updatedCase.patientId?.name,
        riskLevel: updatedCase.aiAnalysis?.riskLevel // Help doctor prioritize visually
      });
    }

    // 2. Build Push Messages
    const doctors = await User.find({ role: 'doctor', pushToken: { $ne: null } });
    let messages = [];

    for (let doc of doctors) {
      if (!Expo.isExpoPushToken(doc.pushToken)) continue;
      
      messages.push({
        to: doc.pushToken,
        sound: 'default',
        title: 'Action Required: New Case 🩺',
        body: `[${updatedCase.aiAnalysis?.riskLevel || 'Normal'} Priority] AI analysis complete for ${updatedCase.patientId?.name}.`,
        data: { caseId: updatedCase._id, role: 'doctor' },
        priority: 'high',
        channelId: 'default'
      });
    }

    // 3. Send in Chunks
    if (messages.length > 0) {
      let chunks = expo.chunkPushNotifications(messages);
      for (let chunk of chunks) {
        try {
          let tickets = await expo.sendPushNotificationsAsync(chunk);
          // PRODUCTION LOGIC: In a real app, you'd inspect 'tickets' here 
          // to find 'DeviceNotRegistered' and delete those tokens from the User model.
        } catch (error) {
          console.error("Expo Chunk Error:", error);
        }
      }
    }
    console.log(`✅ Doctor notifications dispatched for Case: ${caseId}`);
  } catch (error) {
    console.error("Notification System Failure:", error);
  }
};

/**
 * 🔵 NOTIFY PATIENT: Specialist Review Complete
 */
exports.notifyPatientReportReady = async (caseId) => {
  try {
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId');
    const patient = updatedCase.patientId;

    if (!patient?.pushToken || !Expo.isExpoPushToken(patient.pushToken)) {
      console.log(`No valid push token for patient ${patient?.name}`);
      return;
    }

    const message = {
      to: patient.pushToken,
      sound: 'default',
      title: 'Medical Report Ready! ✅',
      body: `Hi ${patient.name.split(' ')[0]}, your specialist review is now available.`,
      data: { caseId: updatedCase._id, screen: 'case-summary' },
      priority: 'high',
      channelId: 'default'
    };

    await expo.sendPushNotificationsAsync([message]);
    console.log(`✅ Success: Notification sent to patient ${patient.name}`);
  } catch (error) {
    console.error("❌ Patient Notification Error:", error);
  }
};