const MedicalRecord = require('../models/MedicalRecord');
const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService');
const config = require('../config');
const mongoose = require('mongoose');

/**
 * @desc    Get Patient Dashboard (Includes Active Case Tracker logic)
 * @route   GET /api/patient/dashboard
 */
exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user._id;

    const draftReports = await MedicalRecord.find({ 
      userId, 
      isSubmitted: false 
    })
      .select('title category reportDate createdAt contentType fileName')
      .sort({ createdAt: -1 })
      .lean();

    const activeCase = await ReviewCase.findOne({ 
      patientId: userId, 
      status: { $in: ['AI_PROCESSING', 'PENDING_DOCTOR', 'COMPLETED'] } 
    })
      .populate('recordIds', 'title category')
      .populate('doctorId', 'name specialization')
      .sort({ createdAt: -1 })
      .lean();

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
 * @desc    Reuse Record from Medical Vault
 * @route   POST /api/patient/records/reuse
 */
exports.reuseRecord = async (req, res) => {
  try {
    const { reportId } = req.body;
    
    const original = await MedicalRecord.findOne({ 
      _id: reportId, 
      userId: req.user._id 
    });
    
    if (!original) {
      return res.status(404).json({ success: false, message: "Original record not found in vault." });
    }

    const newDraft = new MedicalRecord({
      userId: req.user._id,
      title: `${original.title} (Reused)`,
      category: original.category,
      reportDate: original.reportDate,
      fileType: original.fileType,
      contentType: original.contentType,
      fileData: original.fileData,
      fileName: original.fileName,
      isSubmitted: false 
    });

    await newDraft.save();

    res.status(200).json({ 
      success: true, 
      message: "Record successfully imported from vault to drafts.",
      data: { id: newDraft._id, title: newDraft.title }
    });
  } catch (error) {
    console.error("Reuse Record Error:", error);
    res.status(500).json({ success: false, message: "Failed to import record from vault." });
  }
};

/**
 * @desc    Submit reports for Specialist Review
 * @route   POST /api/patient/submit-review
 */
exports.submitReview = async (req, res) => {
  const { reportIds } = req.body; 
  const session = await mongoose.startSession();
  
  try {
    let newCaseId;
    await session.withTransaction(async () => {
      const ownedRecords = await MedicalRecord.find({ 
        _id: { $in: reportIds }, 
        userId: req.user._id 
      }).session(session);

      if (ownedRecords.length !== reportIds.length) {
        throw new Error("UNAUTHORIZED_ACCESS");
      }

      const newCase = new ReviewCase({ 
        patientId: req.user._id, 
        recordIds: reportIds, 
        status: 'AI_PROCESSING' 
      });
      await newCase.save({ session });
      newCaseId = newCase._id;

      await MedicalRecord.updateMany(
        { _id: { $in: reportIds } }, 
        { $set: { isSubmitted: true } }, 
        { session }
      );
    });

    if (global.io) {
      global.io.to('doctor').emit('new_case_submitted', { 
        caseId: newCaseId, 
        patientName: req.user.name 
      });
    }

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
 * @desc    Upload Medical Record
 * @route   POST /api/patient/upload
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
 * @desc    Track status of a specific case
 * @route   GET /api/patient/case/:caseId
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
 * @desc    Fetch Case History
 * @route   GET /api/patient/history
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
 * @desc    View Medical Document
 * @route   GET /api/patient/view/:id
 */
exports.viewLocalFile = async (req, res) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: "Record not found." });

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
 * @desc    Delete a record (Drafts only)
 * @route   DELETE /api/patient/record/:id
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