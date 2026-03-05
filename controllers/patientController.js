const MedicalRecord = require('../models/MedicalRecord');
const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService');
const config = require('../config');
const mongoose = require('mongoose');

/**
 * @desc    Get Patient Dashboard (Reports & Stats)
 * @route   GET /api/patient/dashboard
 */
exports.getDashboard = async (req, res) => {
  try {
    const reports = await MedicalRecord.find({ userId: req.user._id })
      .select('title status category reportDate createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const formattedReports = reports.map(r => ({
      ...r,
      displayUrl: `${config.appUrl}/api/patient/view/${r._id}`
    }));

    res.status(200).json({ 
      success: true, 
      data: { 
        name: req.user.name, 
        reports: formattedReports,
        stats: { 
          total: reports.length, 
          underReview: reports.filter(r => r.status === 'UNDER_REVIEW').length 
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

      // 3. Update Record Statuses
      await MedicalRecord.updateMany(
        { _id: { $in: reportIds } }, 
        { $set: { status: 'UNDER_REVIEW', submittedAt: new Date() } }, 
        { session }
      );
    });

    // 4. Socket.io Emit (For online doctors)
    if (global.io) {
      global.io.to('doctor').emit('new_case_submitted', { 
        caseId: newCaseId, 
        patientName: req.user.name 
      });
    }

    // 5. Trigger AI Analysis (Background Task - Fire and Forget)
    // aiService.analyzeReports will handle status transition to PENDING_DOCTOR
    aiService.analyzeReports(newCaseId); 

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
      fileName: req.file.originalname
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
 * @route   GET /api/patient/case-status/:caseId
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

    // UI helper steps for the frontend progress bar
    const uiSteps = { 
      docsUploaded: true, 
      aiCompleted: !['AI_PROCESSING', 'PROCESSING'].includes(patientCase.status), 
      doctorStarted: !!patientCase.doctorId || patientCase.status === 'COMPLETED' 
    };

    res.status(200).json({ success: true, data: { ...patientCase, uiSteps } });
  } catch (error) {
    console.error("Get Case Status Error:", error);
    res.status(500).json({ success: false, message: "Error tracking case." });
  }
};

/**
 * @desc    View Medical Document (Stream buffer to app)
 * @route   GET /api/patient/view/:id
 */
exports.viewLocalFile = async (req, res) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: "Record not found." });

    // Verify ownership or doctor authorization
    const isOwner = record.userId.toString() === req.user._id.toString();
    const isAuthorizedDoctor = req.user.role === 'doctor'; // Add more granular checks if needed

    if (!isOwner && !isAuthorizedDoctor) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    // Set headers to display inline in mobile WebView/Browser
    res.set({
      'Content-Type': record.contentType,
      'Content-Disposition': `inline; filename="${record.fileName || 'document'}"`,
      'Cache-Control': 'private, max-age=3600'
    });

    res.send(record.fileData);
  } catch (error) {
    console.error("File View Error:", error);
    res.status(500).json({ success: false, message: "Error loading file." });
  }
};

/**
 * @desc    Delete a record
 * @route   DELETE /api/patient/record/:id
 */
exports.deleteRecord = async (req, res) => {
  try {
    const result = await MedicalRecord.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user._id 
    });

    if (!result) return res.status(404).json({ success: false, message: "Record not found or unauthorized." });

    res.status(200).json({ success: true, message: "Record deleted." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting record." });
  }
};

exports.getReviewHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { patientId: req.user._id };

    const cases = await ReviewCase.find(query)
      .select('-__v') 
      .populate('doctorId', 'name specialization')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await ReviewCase.countDocuments(query);

    res.status(200).json({ 
      success: true, 
      data: cases,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("History Error:", error);
    res.status(500).json({ success: false, message: "Error fetching history." });
  }
};