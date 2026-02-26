const MedicalRecord = require('../models/MedicalRecord');
const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService');
const config = require('../config');
const mongoose = require('mongoose');

/**
 * @desc    Get Patient Dashboard
 * @route   GET /api/patient/dashboard
 */
exports.getDashboard = async (req, res) => {
  try {
    // 🛡️ Security: select() excludes heavy fileData buffers to keep the response light
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
 * @desc    Submit for Second Opinion (Atomic Transaction)
 * @route   POST /api/patient/submit-review
 */
exports.submitReview = async (req, res) => {
  const { reportIds } = req.body;
  const patientId = req.user._id;

  if (!reportIds || !Array.isArray(reportIds) || reportIds.length === 0) {
    return res.status(400).json({ success: false, message: "Please select at least one report." });
  }

  // 🟢 ATOMIC TRANSACTION
  const session = await mongoose.startSession();

  try {
    let newCaseId;

    await session.withTransaction(async () => {
      // 1. Verify Ownership within session
      const ownedRecords = await MedicalRecord.find({
        _id: { $in: reportIds },
        userId: patientId 
      }).session(session);

      if (ownedRecords.length !== reportIds.length) {
        throw new Error("UNAUTHORIZED_ACCESS");
      }

      // 2. Create the Review Case
      const newCase = new ReviewCase({
        patientId: patientId,
        recordIds: reportIds,
        status: 'AI_PROCESSING'
      });
      
      await newCase.save({ session });
      newCaseId = newCase._id;

      // 3. Mark records as "Under Review"
      await MedicalRecord.updateMany(
        { _id: { $in: reportIds } },
        { $set: { status: 'UNDER_REVIEW', submittedAt: new Date() } },
        { session }
      );
    });

    // 4. Trigger AI Background Task (Outside transaction)
    aiService.analyzeReports(newCaseId);

    res.status(200).json({ 
      success: true, 
      message: "Case submitted successfully!",
      caseId: newCaseId 
    });

  } catch (error) {
    console.error("🔥 SUBMIT ERROR:", error);
    const isAuthError = error.message === "UNAUTHORIZED_ACCESS";
    res.status(isAuthError ? 403 : 500).json({ 
      success: false, 
      message: isAuthError ? "Unauthorized access to records." : "Failed to initiate review."
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get Detailed Case Status
 * @route   GET /api/patient/case/:caseId
 */
exports.getCaseStatus = async (req, res) => {
  try {
    const { caseId } = req.params;

    const patientCase = await ReviewCase.findById(caseId)
      .populate('recordIds', 'title category reportDate')
      .populate('doctorId', 'name specialization')
      .lean();

    if (!patientCase) {
      return res.status(404).json({ success: false, message: "Case not found." });
    }

    // Security check: Ensure patient owns this case
    if (patientCase.patientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized access." });
    }

    const uiSteps = {
      docsUploaded: true,
      aiCompleted: patientCase.status !== 'AI_PROCESSING', 
      doctorStarted: !!patientCase.doctorId || patientCase.status === 'COMPLETED'
    };

    res.status(200).json({ 
      success: true, 
      data: { ...patientCase, uiSteps } 
    });

  } catch (error) {
    console.error("Status Check Error:", error);
    res.status(500).json({ success: false, message: "Server error tracking case." });
  }
};

/**
 * @desc    Get all cases for history screen (Paginated)
 * @route   GET /api/patient/history
 */
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

/**
 * @desc    Stream File Content Securely
 * @route   GET /api/patient/view/:id
 */
exports.viewLocalFile = async (req, res) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: "Record not found." });
    }

    const userId = req.user._id.toString();
    const isOwner = record.userId.toString() === userId;
    
    let isAuthorizedDoctor = false;
    if (req.user.role === 'doctor') {
      const associatedCase = await ReviewCase.findOne({
        recordIds: record._id,
        $or: [{ doctorId: userId }, { status: 'PENDING_DOCTOR' }]
      });
      if (associatedCase) isAuthorizedDoctor = true;
    }

    if (!isOwner && !isAuthorizedDoctor) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    res.set({
      'Content-Type': record.contentType,
      'Cache-Control': 'private, max-age=3600' 
    });
    res.send(record.fileData);

  } catch (error) {
    console.error("File View Error:", error);
    res.status(500).json({ success: false, message: "Error loading file." });
  }
};