const User = require('../models/User');
const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

/**
 * 🟡 START ANALYSIS
 * Triggered when a patient successfully pays/uploads.
 * Updates status and kicks off the background AI process.
 */
exports.startCaseAnalysis = async (req, res) => {
  try {
    const { caseId } = req.params;

    // Update status so UI shows "AI Processing"
    await ReviewCase.findByIdAndUpdate(caseId, { status: 'AI_PROCESSING' });

    // 🟢 PRODUCTION LOGIC: Background Execution
    // We don't 'await' this because we want to return a response to the app immediately
    // while the AI works in the background (which can take 30-60 seconds).
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
 * Called by aiService once the background processing is finished.
 */
exports.notifyDoctorCaseReady = async (caseId) => {
  try {
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId');
    if (!updatedCase) return;
    
    // 1. Socket Emit: Syncing the tracker strip in Patient UI
    if (global.io) {
      global.io.emit('caseStatusUpdate', { 
        caseId: updatedCase._id, 
        status: 'PENDING_DOCTOR', 
        patientId: updatedCase.patientId?._id 
      });

      // Alert doctors in the 'doctor' socket room
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
        data: { 
          caseId: updatedCase._id.toString(), 
          type: 'NEW_CASE',
          screen: 'doctor-review'
        },
        priority: 'high',
        channelId: 'default'
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
 * Triggered by the doctor submitting their final opinion.
 */
exports.notifyPatientReportReady = async (caseId) => {
  try {
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId');
    if (!updatedCase || !updatedCase.patientId) return;

    const patient = updatedCase.patientId;

    // 1. Socket Emit: Instant UI update if app is open
    if (global.io) {
      global.io.emit('caseStatusUpdate', {
        caseId: updatedCase._id,
        status: 'COMPLETED',
        patientId: patient._id
      });
    }

    // 2. Push Notification logic for "1-2 day" wait period
    if (patient.pushToken && Expo.isExpoPushToken(patient.pushToken)) {
      const message = {
        to: patient.pushToken,
        sound: 'default',
        title: 'Medical Report Ready! ✅',
        body: `Hi ${patient.name.split(' ')[0]}, your specialist review is now available.`,
        data: { 
          caseId: updatedCase._id.toString(), 
          type: 'REPORT_READY',
          screen: 'case-summary' 
        },
        priority: 'high',
        channelId: 'default'
      };

      await expo.sendPushNotificationsAsync([message]);
      console.log(`✅ Success: Notification sent to patient ${patient.name}`);
    }
  } catch (error) {
    console.error("❌ Patient Notification Error:", error);
  }
};