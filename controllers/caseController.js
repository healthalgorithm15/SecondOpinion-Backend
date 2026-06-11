const User = require('../models/User');
const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService');
const caseService = require('../services/caseService');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

/**
 * 🟢 GET ALL SPECIALISTS (For CMO Dropdown)
 * Fetches real users with the 'doctor' role.
 */
exports.getAllSpecialists = async (req, res) => {
  try {
    // Only fetch users who are registered as specialists
    const doctors = await User.find({ role: 'doctor' })
      .select('name email specializations status')
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

/**
 * 🟡 START ANALYSIS
 */
exports.startCaseAnalysis = async (req, res) => {
  try {
    const { caseId } = req.params;

    await ReviewCase.findByIdAndUpdate(caseId, { 
      status: 'AI_PROCESSING',
      assignedTo: null 
    });

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
 */
exports.notifyDoctorCaseReady = async (caseId) => {
  try {
    const updatedCase = await ReviewCase.findByIdAndUpdate(
      caseId, 
      { status: 'UNASSIGNED' }, 
      { new: true }
    ).populate('patientId', 'name pushToken');

    if (!updatedCase) return;
    
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

exports.assignCase = async (req, res) => {
  try {
    const { caseId, doctorId, note } = req.body; // Frontend sends specialistId, mapping to doctorId

    if (!['cmo', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Unauthorized: CMO access required" });
    }

    // This one line now handles DB update, History, and the Push Notification!
    const updatedCase = await caseService.assignCaseToSpecialist(
      caseId, 
      doctorId, 
      req.user._id, 
      note
    );

    res.status(200).json({ success: true, data: updatedCase });
  } catch (error) {
    console.error("Assignment Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 🟢 GET PENDING CASES
 */
exports.getDoctorCases = async (req, res) => {
  try {
    let query = {};
    const role = req.user?.role ? req.user.role.toLowerCase() : 'unknown';
    const isCmoView = req.query.view === 'all';

    if (isCmoView || role === 'cmo' || role === 'admin') {
      query = { 
        status: { 
          $in: [      
            'PENDING',           
            'AI_PROCESSING',     
            'UNASSIGNED',        
            'PENDING_DOCTOR',    
            'PENDING_CMO_APPROVAL' 
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

    res.status(200).json({ success: true, count: cases.length, data: cases });
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
        body: `Hi ${patient.name.split(' ')[0]}, your specialist review is now available.`,
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
 * 📢 NOTIFY CMO: Specialist submitted review
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
 */
/**
 * 🏁 FINAL STEP: CMO APPROVAL & EDIT
 */
exports.cmoFinalApproval = async (req, res) => {
  try {
    const { caseId, updatedVerdict, updatedRecommendations, cmoPrivateNote } = req.body;

    if (!['cmo', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "CMO authority required." });
    }

    // 1. Fetch the existing case first to make sure we have the Doctor's original data intact
    const existingCase = await ReviewCase.findById(caseId);
    if (!existingCase) return res.status(404).json({ success: false, message: "Case not found" });

    // 2. Map data cleanly to separate isolated layers matching your Mongoose Schema
    const updateData = {
      status: 'COMPLETED',
      
      // 👑 Save directly into the dedicated Chief Medical Officer isolation block
      'cmoOpinion.approvedBy': req.user._id,
      'cmoOpinion.approvedAt': new Date(),
      'cmoOpinion.updatedVerdict': updatedVerdict ? String(updatedVerdict).trim() : "Approved and signed off by Executive Medical Board.",
      'cmoOpinion.updatedRecommendations': updatedRecommendations ? String(updatedRecommendations).trim() : "The Chief Medical Officer has fully verified the clinical roadmap outlined below.",
    };

    // If the optional private note exists, route it safely to the cmoOpinion subfield
    if (cmoPrivateNote) {
      updateData['cmoOpinion.cmoPrivateNote'] = cmoPrivateNote;
    }

    // 3. Update the database using explicit dot-notation $set to safely guard both layers
    const updatedCase = await ReviewCase.findByIdAndUpdate(
      caseId, 
      { $set: updateData }, 
      { new: true }
    ).populate('patientId assignedTo doctorId'); // Fully populate reference objects

    // 4. Trigger push notification systems out to the mobile client
    await exports.notifyPatientReportReady(caseId);

    res.status(200).json({ 
      success: true, 
      message: "Report finalized and published successfully with both clinical feedback layers.",
      data: updatedCase 
    });
  } catch (error) {
    console.error("❌ [CMO APPROVAL SYSTEM ERROR]:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Inside caseController.js
exports.selfAssign = async (req, res) => {
  try {
    const { caseId } = req.body;
    const updatedCase = await caseService.selfAssignCMO(caseId, req.user._id);
    res.status(200).json({ success: true, data: updatedCase });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};