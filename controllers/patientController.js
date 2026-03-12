const MedicalRecord = require('../models/MedicalRecord');
const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService');
const config = require('../config');
const mongoose = require('mongoose');

/**
 * @desc    Get Patient Dashboard (Includes Active Case Tracker logic)
 * @route   GET /api/patient/dashboard
 * @access  Private (Patient)
 */
exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Fetch Drafts (Uploaded but not yet submitted for review)
    const draftReports = await MedicalRecord.find({ 
      userId, 
      isSubmitted: false 
    })
      .select('title category reportDate createdAt contentType fileName')
      .sort({ createdAt: -1 })
      .lean();

    /**
     * 2. Fetch Active Case (The "Tracker" state)
     * CRITICAL: We include 'COMPLETED' here so the tracker strip stays visible
     * on the landing page even after the doctor submits the final verdict.
     * This allows the patient to click the "Green" tracker to view results.
     */
    const activeCase = await ReviewCase.findOne({ 
      patientId: userId, 
      status: { $in: ['AI_PROCESSING', 'PENDING_DOCTOR', 'COMPLETED'] } 
    })
      .populate('recordIds', 'title category')
      .populate('doctorId', 'name specialization')
      .sort({ createdAt: -1 }) // Get the most recent one
      .lean();

    // Format draft reports with viewing URLs for the frontend
    const formattedDrafts = draftReports.map(r => ({
      ...r,
      _id: r._id.toString(),
      displayUrl: `${config.appUrl}/api/patient/view/${r._id}`
    }));

    res.status(200).json({ 
      success: true, 
      data: { 
        name: req.user.name, 
        reports: formattedDrafts, 
        activeCase: activeCase || null,
        stats: { 
          totalDrafts: draftReports.length,
          hasActiveCase: !!activeCase
        }
      }
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ success: false, message: "Error loading dashboard." });
  }
};

/**
 * @desc    Submit reports for Specialist Review (Atomic Transaction)
 * @route   POST /api/patient/submit-review
 */
exports.submitReview = async (req, res) => {
  const { reportIds } = req.body; 
  const session = await mongoose.startSession();
  
  try {
    let newCaseId;
    await session.withTransaction(async () => {
      // 1. Verify ownership of records
      const ownedRecords = await MedicalRecord.find({ 
        _id: { $in: reportIds }, 
        userId: req.user._id 
      }).session(session);

      if (ownedRecords.length !== reportIds.length) {
        throw new Error("UNAUTHORIZED_ACCESS");
      }

      // 2. Create the Review Case
      const newCase = new ReviewCase({ 
        patientId: req.user._id, 
        recordIds: reportIds, 
        status: 'AI_PROCESSING' 
      });
      await newCase.save({ session });
      newCaseId = newCase._id;

      // 3. Mark records as submitted to move them from 'Drafts' to 'Active Case'
      await MedicalRecord.updateMany(
        { _id: { $in: reportIds } }, 
        { $set: { isSubmitted: true } }, 
        { session }
      );
    });

    // 4. Notify Specialist via Socket.io
    if (global.io) {
      global.io.to('doctor').emit('new_case_submitted', { 
        caseId: newCaseId, 
        patientName: req.user.name 
      });
    }

    // 5. Trigger Resilient AI Analysis pipeline (Non-blocking)
    // The aiService now handles its own retries and fallbacks
    aiService.analyzeReports(newCaseId).catch(err => {
      console.error("Background AI Analysis Error:", err);
    });

    res.status(200).json({ success: true, caseId: newCaseId });
  } catch (error) {
    console.error("Submit Review Error:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Upload Medical Record (Initial Draft)
 */
exports.uploadRecord = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file provided." });
    }

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
 * @desc    Track status of a specific case (Polling/Details)
 */
exports.getCaseStatus = async (req, res) => {
  try {
    const patientCase = await ReviewCase.findById(req.params.caseId)
      .populate('recordIds', 'title category reportDate')
      .populate('doctorId', 'name specialization')
      .lean();

    if (!patientCase || patientCase.patientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    // Map status to frontend Stepper steps for the Tracker UI
    const uiSteps = { 
      docsUploaded: true, 
      aiCompleted: !['AI_PROCESSING', 'UPLOADED'].includes(patientCase.status), 
      doctorStarted: !!patientCase.doctorId || patientCase.status === 'COMPLETED' 
    };

    res.status(200).json({ success: true, data: { ...patientCase, uiSteps } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error tracking case." });
  }
};

/**
 * @desc    Fetch Case History (Populates Medical Vault)
 */
exports.getReviewHistory = async (req, res) => {
  try {
    const cases = await ReviewCase.find({ patientId: req.user._id })
      .populate('recordIds', 'title fileName contentType createdAt')
      .populate('doctorId', 'name specialization')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ success: true, data: cases });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching history." });
  }
};

/**
 * @desc    View Medical Document (Buffer stream)
 * @route   GET /api/patient/view/:id
 */
exports.viewLocalFile = async (req, res) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: "Record not found." });

    // Permissions check
    if (record.userId.toString() !== req.user._id.toString() && req.user.role !== 'doctor') {
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
 * @desc    Delete a record (Drafts only - prevents deleting records in active review)
 */
exports.deleteRecord = async (req, res) => {
  try {
    const result = await MedicalRecord.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user._id,
      isSubmitted: false 
    });

    if (!result) return res.status(404).json({ success: false, message: "Record locked or not found." });

    res.status(200).json({ success: true, message: "Record deleted." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting record." });
  }
};