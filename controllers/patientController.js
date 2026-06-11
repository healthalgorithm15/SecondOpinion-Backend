const MedicalRecord = require('../models/MedicalRecord');
const ReviewCase = require('../models/ReviewCase');
const Transaction = require('../models/Transaction'); 
const aiService = require('../services/aiService');
const mongoose = require('mongoose');

/**
 * @desc    Get Patient Dashboard (Dynamic Scenario Handling)
 * @route   GET /api/patient/dashboard
 */
exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Get the most recent active case (Matches strict Schema enum uppercase)
    const activeCase = await ReviewCase.findOne({ 
      patientId: userId, 
      status: { $ne: 'COMPLETED' } 
    }).sort({ createdAt: -1 });

    // 2. Check for Unused Payment Credit
    const unusedPayment = await Transaction.findOne({
      patientId: userId,
      status: 'paid',
      $or: [
        { scanId: { $exists: false } },
        { scanId: null }
      ]
    });

    // 3. Fetch Draft Reports (Not yet submitted to a case)
    const draftReports = await MedicalRecord.find({ 
      userId: userId, 
      isSubmitted: false 
    }).select('title category reportDate fileName fileType createdAt').sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: {
        user: {
          name: req.user.name,
          email: req.user.email,
          _id: req.user._id
        },
        activeCase: activeCase || null,
        hasActivePayment: !!unusedPayment,
        draftReports: draftReports || [] 
      }
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * @desc    Submit reports for Specialist Review (Atomic Transaction)
 * @route   POST /api/patient/submit-review
 */
exports.submitReview = async (req, res) => {
  const { reportIds, patientNote } = req.body; 
  const userId = req.user._id;

  if (!reportIds || reportIds.length === 0) {
    return res.status(400).json({ success: false, message: "No reports selected for submission." });
  }

  const session = await mongoose.startSession();
  
  try {
    let newCaseId;

    await session.withTransaction(async () => {
      // 1. Verify ownership of draft records
      const ownedRecords = await MedicalRecord.find({ 
        _id: { $in: reportIds }, 
        userId: userId,
        isSubmitted: false 
      }).session(session);

      if (ownedRecords.length !== reportIds.length) {
        throw new Error("UNAUTHORIZED_ACCESS_OR_INVALID_RECORDS");
      }

      // 2. Verify and Consume Payment Credit
      const paymentCredit = await Transaction.findOne({
        patientId: userId,
        status: 'paid',
        $or: [
          { scanId: null },
          { scanId: { $exists: false } }
        ]
      }).session(session);

      if (!paymentCredit) throw new Error("NO_ACTIVE_PAYMENT");

      // 3. Create the Review Case with the Patient Note
      const newCase = new ReviewCase({ 
        patientId: userId, 
        recordIds: reportIds, 
        patientNote: patientNote || "", 
        status: 'AI_PROCESSING' 
      });
      await newCase.save({ session });
      newCaseId = newCase._id;

      // 4. Mark credit as "Used" (Link transaction to case)
      paymentCredit.scanId = newCaseId;
      await paymentCredit.save({ session });

      // 5. Mark draft records as submitted
      await MedicalRecord.updateMany(
        { _id: { $in: reportIds } }, 
        { $set: { isSubmitted: true } }, 
        { session }
      );
    });

    // 6. Notify doctors/CMO via Socket.io
    if (global.io) {
      global.io.to('doctor').emit('new_case_submitted', { 
        caseId: newCaseId, 
        patientName: req.user.name 
      });
    }

    // 7. Trigger AI background service
    aiService.analyzeReports(newCaseId).catch(err => console.error("AI Service Error:", err)); 

    res.status(200).json({ success: true, caseId: newCaseId });
  } catch (error) {
    console.error("Submit Review Error:", error);
    let statusCode = 500;
    let message = "Internal Server Error";

    if (error.message === "NO_ACTIVE_PAYMENT") {
      statusCode = 402;
      message = "No active analysis credit found. Please purchase a credit.";
    } else if (error.message === "UNAUTHORIZED_ACCESS_OR_INVALID_RECORDS") {
      statusCode = 403;
      message = "Some records are invalid or already submitted.";
    }

    res.status(statusCode).json({ success: false, message });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Reuse a record from the Medical Vault (creates a new draft copy)
 */
exports.reuseRecord = async (req, res) => {
  try {
    const { reportId } = req.body;
    const userId = req.user._id;

    const original = await MedicalRecord.findById(reportId);
    if (!original) return res.status(404).json({ success: false, message: "Record not found." });

    if (original.userId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }

    const reusedRecord = new MedicalRecord({
      userId,
      title: `${original.title} (Ref)`,
      category: original.category,
      fileType: original.fileType,
      fileUrl: original.fileUrl,
      fileData: original.fileData,
      contentType: original.contentType,
      fileName: original.fileName,
      isSubmitted: false 
    });

    await reusedRecord.save();
    res.status(200).json({ success: true, message: "Added to drafts." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to reuse record." });
  }
};

/**
 * @desc    Upload Medical Record (saves to drafts)
 */
exports.uploadRecord = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file provided." });

    const newRecord = new MedicalRecord({
      userId: req.user._id,
      title: (req.body.title || req.file.originalname).trim(),
      category: req.body.category || 'General',
      reportDate: req.body.reportDate || new Date(),
      fileType: req.file.mimetype.startsWith('image/') ? 'image' : 'pdf',
      contentType: req.file.mimetype,
      fileData: req.file.buffer, 
      fileName: req.file.originalname,
      isSubmitted: false 
    });

    await newRecord.save();
    res.status(201).json({ 
      success: true, 
      message: "Report uploaded successfully.", 
      data: { id: newRecord._id, title: newRecord.title } 
    });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ success: false, message: "Upload failed." });
  }
};

/**
 * @desc    Track status of a specific case (UI Progress Tracker)
 */
exports.getCaseStatus = async (req, res) => {
  try {
    const patientCase = await ReviewCase.findById(req.params.caseId)
      .populate('recordIds', 'title category reportDate')
      .populate('assignedTo', 'name specialization') 
      .lean();

    if (!patientCase || patientCase.patientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const isReady = patientCase.status === 'COMPLETED';
    
    // 🛡️ SECURITY GATE: Wipe opinions from context if the report isn't completely published yet
    if (!isReady) {
      delete patientCase.doctorOpinion;
      delete patientCase.cmoOpinion;
    }

    // ⚙️ EXTENDED TELEMETRY: Maps every schema workflow checkpoint cleanly to React Native step engines
    const uiSteps = { 
      docsUploaded: true, 
      aiCompleted: !['AI_PROCESSING'].includes(patientCase.status), 
      doctorAssigned: !!patientCase.assignedTo || ['PENDING_DOCTOR', 'PENDING_CMO_APPROVAL', 'COMPLETED'].includes(patientCase.status),
      doctorSubmitted: ['PENDING_CMO_APPROVAL', 'COMPLETED'].includes(patientCase.status),
      cmoValidated: isReady 
    };

    res.status(200).json({ success: true, data: { ...patientCase, uiSteps } });
  } catch (error) {
    console.error("❌ Status Tracker Error:", error);
    res.status(500).json({ success: false, message: "Error tracking case." });
  }
};

/**
 * @desc    View Medical Document (Serves binary data)
 */
exports.viewLocalFile = async (req, res) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: "Record not found." });

    if (record.userId.toString() !== req.user._id.toString() && !['doctor', 'cmo', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    res.set({
      'Content-Type': record.contentType,
      'Content-Disposition': `inline; filename="${record.fileName || 'document'}"`,
      'Cache-Control': 'private, max-age=3600'
    });

    res.send(record.fileData);
  } catch (error) {
    res.status(500).json({ success: false, message: "Error loading file." });
  }
};

/**
 * @desc    Delete a draft record
 */
exports.deleteRecord = async (req, res) => {
  try {
    const result = await MedicalRecord.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user._id,
      isSubmitted: false 
    });

    if (!result) return res.status(404).json({ success: false, message: "Record cannot be deleted." });

    res.status(200).json({ success: true, message: "Record deleted." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting record." });
  }
};

/**
 * @desc    Fetch Complete Case History (Vault) - SANITIZED
 */
exports.getReviewHistory = async (req, res) => {
  try {
    const cases = await ReviewCase.find({ patientId: req.user._id })
      .populate('recordIds', 'title fileName contentType createdAt')
      .populate('doctorId', 'name specialization')
      .sort({ createdAt: -1 })
      .lean();

    // 🛡️ SECURITY GATE: Ensure internal medical feedback layouts stay hidden until finalized by CMO
    const sanitizedHistory = cases.map(c => {
      if (c.status !== 'COMPLETED') {
        delete c.doctorOpinion;
        delete c.cmoOpinion;
      }
      return c;
    });

    res.status(200).json({ success: true, data: sanitizedHistory });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching history." });
  }
};

/**
 * @desc    Get Detailed Case by ID - SANITIZED
 */
exports.getPatientCaseById = async (req, res) => {
  try {
    const caseData = await ReviewCase.findById(req.params.id)
      .populate('doctorId', 'name specialization')
      .populate('recordIds', 'title category');

    if (!caseData || caseData.patientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const responseData = caseData.toObject();
    
    // 🛡️ SECURITY GATE: Strictly hide dynamic reviews from payloads unless fully signed off by CMO
    if (responseData.status !== 'COMPLETED') {
      delete responseData.doctorOpinion; 
      delete responseData.cmoOpinion;
    }
    
    res.status(200).json({ success: true, data: responseData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};