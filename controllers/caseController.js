const User = require('../models/User');
const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

/**
 * 🟡 START ANALYSIS
 */
exports.startCaseAnalysis = async (req, res) => {
  try {
    const { caseId } = req.params;

    await ReviewCase.findByIdAndUpdate(caseId, { status: 'AI_PROCESSING' });

    // Background Execution - AI will call notifyDoctorCaseReady when done
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
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId');
    if (!updatedCase) return;
    
    // 1. Socket Emit: Syncing the tracker strip in Patient UI
    if (global.io) {
      global.io.emit('caseStatusUpdate', { 
        caseId: updatedCase._id, 
        status: 'PENDING_DOCTOR', // This moves the stepper to stage 3
        patientId: updatedCase.patientId?._id 
      });

      global.io.to('doctor').emit('case_ready_for_review', {
        caseId: updatedCase._id,
        patientName: updatedCase.patientId?.name,
        riskLevel: updatedCase.aiAnalysis?.riskLevel
      });
    }

    // 2. Doctor Push Notifications
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
        priority: 'high'
      });
    }

    if (messages.length > 0) {
      let chunks = expo.chunkPushNotifications(messages);
      for (let chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
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
    // CRITICAL: We must populate patientId to access the pushToken
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId');
    
    if (!updatedCase || !updatedCase.patientId) {
      console.error("❌ Notification Failed: Could not find patient details for case", caseId);
      return;
    }

    const patient = updatedCase.patientId;

    // 1. Socket Emit: Update Tracker Strip to "COMPLETED"
    if (global.io) {
      global.io.emit('caseStatusUpdate', {
        caseId: updatedCase._id,
        status: 'COMPLETED',
        patientId: patient._id
      });
    }

    // 2. Push Notification logic
    if (patient.pushToken && Expo.isExpoPushToken(patient.pushToken)) {
      const message = {
        to: patient.pushToken,
        sound: 'default',
        title: 'Medical Report Ready! ✅',
        body: `Hi ${patient.name.split(' ')[0]}, your specialist review is now available.`,
        data: { caseId: updatedCase._id, screen: 'case-summary' },
        priority: 'high'
      };

      await expo.sendPushNotificationsAsync([message]);
      console.log(`✅ Success: Notification sent to patient ${patient.name}`);
    } else {
      console.warn(`⚠️ Patient ${patient.name} has no valid Expo Push Token.`);
    }
  } catch (error) {
    console.error("❌ Patient Notification Error:", error);
  }
};