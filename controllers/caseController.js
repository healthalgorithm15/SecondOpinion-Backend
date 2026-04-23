const User = require('../models/User');
const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService');
const caseService = require('../services/caseService');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

/**
 * 🟡 START ANALYSIS
 * Triggered manually if needed, or automatically after payment/submission.
 */
exports.startCaseAnalysis = async (req, res) => {
  try {
    const { caseId } = req.params;

    await ReviewCase.findByIdAndUpdate(caseId, { 
      status: 'AI_PROCESSING',
      assignedTo: null 
    });

    // Background Execution: AI Service handles text extraction and logic
    aiService.analyzeReports(caseId).catch(err => {
        console.error(`CRITICAL: Background AI Analysis failed for ${caseId}:`, err);
    });

    res.status(200).json({ success: true, message: "Analysis started" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 🟢 NOTIFY CMO: AI Analysis Complete
 * Moves status to UNASSIGNED so CMO can assign a specialist.
 */
exports.notifyDoctorCaseReady = async (caseId) => {
  try {
    const updatedCase = await ReviewCase.findByIdAndUpdate(
      caseId, 
      { status: 'UNASSIGNED' }, 
      { new: true }
    ).populate('patientId', 'name pushToken');

    if (!updatedCase) return;
    
    // Socket Logic: Live dashboard updates
    if (global.io) {
      global.io.emit('caseStatusUpdate', { 
        caseId: updatedCase._id, 
        status: 'UNASSIGNED', 
        patientId: updatedCase.patientId?._id 
      });

      global.io.to('cmo').emit('new_case_to_assign', {
        caseId: updatedCase._id,
        patientName: updatedCase.patientId?.name,
        riskLevel: updatedCase.aiAnalysis?.riskLevel
      });
    }

    // Notify CMOs via Push Notifications
    const cmos = await User.find({ role: 'cmo', pushToken: { $ne: null } });
    let messages = [];

    for (let cmo of cmos) {
      if (!Expo.isExpoPushToken(cmo.pushToken)) continue;
      messages.push({
        to: cmo.pushToken,
        sound: 'default',
        title: 'New Case for Assignment 📋',
        body: `AI Analysis complete for ${updatedCase.patientId?.name}. Please assign a specialist.`,
        data: { caseId: updatedCase._id.toString(), type: 'ASSIGNMENT_REQUIRED', screen: 'cmo-dashboard' },
        priority: 'high'
      });
    }

    if (messages.length > 0) {
      let chunks = expo.chunkPushNotifications(messages);
      for (let chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    }
  } catch (error) {
    console.error("CMO Notification Failure:", error);
  }
};

/**
 * 🟠 ASSIGN CASE (CMO/Admin ONLY)
 */
exports.assignCase = async (req, res) => {
  try {
    const { caseId, doctorId, note } = req.body;

    if (!['cmo', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Unauthorized: CMO access required" });
    }

    const updatedCase = await caseService.assignCaseToSpecialist(
      caseId, 
      doctorId, 
      req.user._id, 
      note
    );

    res.status(200).json({ success: true, data: updatedCase });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getDoctorCases = async (req, res) => {
  try {

    console.log("DEBUG: Raw Role from Token:", req.user.role);
    console.log("DEBUG: User ID:", req.user._id);
    let query = {};
    const role = req.user.role.toLowerCase();

    if (role === 'cmo' || role === 'admin') {
      // 🟢 ADD 'AI_PROCESSING' and 'PENDING' to the list
      query = { 
        status: { 
          $in: [
            'PENDING',           // Initial submission
            'AI_PROCESSING',     // Currently analyzing
            'UNASSIGNED',        // AI done, needs specialist
            'PENDING_DOCTOR',    // Assigned to Specialist
            'PENDING_CMO_APPROVAL' // Specialist done, needs CMO sign-off
          ] 
        } 
      };
    } else {
      query = { assignedTo: req.user._id, status: 'PENDING_DOCTOR' };
    }

    const cases = await ReviewCase.find(query)
      .populate('patientId', 'name email')
      .select('+patientNote') 
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: cases });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 🔵 NOTIFY PATIENT: Final Report Published
 */
exports.notifyPatientReportReady = async (caseId) => {
  try {
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId');
    if (!updatedCase || !updatedCase.patientId) return;

    if (global.io) {
      global.io.emit('caseStatusUpdate', {
        caseId: updatedCase._id,
        status: 'COMPLETED',
        patientId: updatedCase.patientId._id
      });
    }

    const patient = updatedCase.patientId;
    if (patient.pushToken && Expo.isExpoPushToken(patient.pushToken)) {
      const message = {
        to: patient.pushToken,
        sound: 'default',
        title: 'Medical Report Ready! ✅',
        body: `Hi ${patient.name.split(' ')[0]}, your specialist review is now available for download.`,
        data: { caseId: updatedCase._id.toString(), type: 'REPORT_READY', screen: 'case-summary' },
        priority: 'high'
      };
      await expo.sendPushNotificationsAsync([message]);
    }
  } catch (error) {
    console.error("Patient Notification Error:", error);
  }
};


/**
 * 📢 NOTIFY CMO: Specialist has submitted their review
 */
exports.notifyCMOReviewReady = async (caseId) => {
  try {
    const updatedCase = await ReviewCase.findById(caseId).populate('patientId', 'name');
    const cmos = await User.find({ role: 'cmo', pushToken: { $ne: null } });
    
    let messages = [];
    for (let cmo of cmos) {
      if (!Expo.isExpoPushToken(cmo.pushToken)) continue;
      messages.push({
        to: cmo.pushToken,
        sound: 'default',
        title: 'Review Awaiting Approval 🔍',
        body: `A specialist has submitted a verdict for ${updatedCase.patientId?.name}.`,
        data: { caseId: caseId.toString(), type: 'APPROVAL_REQUIRED', screen: 'cmo-approval-detail' },
        priority: 'high'
      });
    }
    if (messages.length > 0) {
      let chunks = expo.chunkPushNotifications(messages);
      for (let chunk of chunks) await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (err) { console.error("CMO Alert Fail:", err); }
};

/**
 * 🏁 FINAL STEP: CMO APPROVAL & EDIT
 * Finalizes the case, allowing the CMO to refine the doctor's recommendations.
 */
exports.cmoFinalApproval = async (req, res) => {
  try {
    const { caseId, updatedVerdict, updatedRecommendations, cmoPrivateNote } = req.body;

    if (!['cmo', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "CMO authority required." });
    }

    const updateData = {
      status: 'COMPLETED',
      'doctorOpinion.approvedBy': req.user._id,
      'doctorOpinion.approvedAt': new Date()
    };

    // Apply CMO overrides if provided
    if (updatedVerdict) updateData['doctorOpinion.finalVerdict'] = updatedVerdict;
    if (updatedRecommendations) updateData['doctorOpinion.recommendations'] = updatedRecommendations;
    if (cmoPrivateNote) updateData['doctorOpinion.cmoPrivateNote'] = cmoPrivateNote;

    const updatedCase = await ReviewCase.findByIdAndUpdate(
      caseId, 
      { $set: updateData }, 
      { new: true }
    ).populate('patientId');

    if (!updatedCase) {
      return res.status(404).json({ success: false, message: "Case not found." });
    }

    // Publish results to patient
    await exports.notifyPatientReportReady(caseId);

    res.status(200).json({ 
      success: true, 
      message: "Report finalized and published to patient vault.",
      data: updatedCase 
    });
  } catch (error) {
    console.error("CMO Approval Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};