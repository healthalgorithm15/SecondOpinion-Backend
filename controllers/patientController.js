const MedicalRecord = require('../models/MedicalRecord');
const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService'); // Logic for Mock/Real AI
const config = require('../config');

/**
 * @desc    Get Patient Dashboard
 * @route   GET /api/patient/dashboard
 * @access  Private (Patient)
 */
exports.getDashboard = async (req, res) => {
  try {
    // 🛡️ Security: Only fetch records for the logged-in user
    const reports = await MedicalRecord.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean(); // Faster performance for read-only queries

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
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Upload Medical Record
 * @route   POST /api/patient/upload
 * @access  Private (Patient)
 */
exports.uploadRecord = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file provided." });
    }

    const newRecord = new MedicalRecord({
      userId: req.user._id,
      title: req.body.title || req.file.originalname,
      category: req.body.category || 'General',
      reportDate: req.body.reportDate || new Date(),
      fileType: req.file.mimetype.startsWith('image/') ? 'image' : 'pdf',
      contentType: req.file.mimetype,
      fileData: req.file.buffer, // Buffer storage for Local mode
      fileName: req.file.originalname
    });

    await newRecord.save();
    res.status(201).json({ 
      success: true, 
      message: "Report uploaded successfully.", 
      data: { id: newRecord._id, title: newRecord.title } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Upload failed. Please try again." });
  }
};

/**
 * @desc    Submit for Second Opinion (AI + Doctor)
 * @route   POST /api/patient/submit-review
 * @access  Private (Patient)
 */
exports.submitReview = async (req, res) => {
  console.log("🚀 Incoming Review Request:", req.body); // Check if data arrives

  try {
    const { reportIds } = req.body;
    const patientId = req.user._id;

    if (!reportIds || !Array.isArray(reportIds) || reportIds.length === 0) {
      console.log("❌ Validation Failed: reportIds missing or not an array");
      return res.status(400).json({ success: false, message: "Please select at least one report." });
    }

    // 🛡️ Ownership Validation
    const ownedRecords = await MedicalRecord.find({
      _id: { $in: reportIds },
      userId: patientId 
    });

    console.log(`🔍 Found ${ownedRecords.length} records in DB for user ${patientId}`);

    if (ownedRecords.length !== reportIds.length) {
      console.log("❌ Ownership Mismatch: User doesn't own all requested records");
      return res.status(403).json({ success: false, message: "Unauthorized record access." });
    }

    // 1. Create the Review Case
    console.log("📝 Attempting to save ReviewCase...");
    const newCase = new ReviewCase({
      patientId: patientId,
      recordIds: reportIds,
      status: 'AI_PROCESSING'
    });
    
    await newCase.save();
    console.log("✅ ReviewCase saved with ID:", newCase._id);

    // 2. Mark records as "Under Review"
    await MedicalRecord.updateMany(
      { _id: { $in: reportIds } },
      { $set: { status: 'UNDER_REVIEW', submittedAt: new Date() } }
    );

    // 3. 🤖 Trigger AI Background Task
    console.log("🤖 Triggering AI Service...");
    aiService.analyzeReports(newCase._id);

    res.status(200).json({ 
      success: true, 
      message: "Case submitted!",
      caseId: newCase._id 
    });

  } catch (error) {
    // 🚩 THIS IS THE MOST IMPORTANT PART: It prints the hidden error to your terminal
    console.error("🔥 CRITICAL SUBMIT ERROR:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to initiate review.", 
      error: error.message 
    });
  }
};

/**
 * @desc    Get Detailed Case Status
 * @route   GET /api/patient/case/:caseId
 * @access  Private (Patient)
 */
/**
 * @desc    Get Detailed Case Status (Optimized for Polling)
 * @route   GET /api/patient/case/:caseId
 */
exports.getCaseStatus = async (req, res) => {
  try {
    const { caseId } = req.params;
    console.log("🔍 Checking Case:", caseId);

    // 1. Fetch case with multi-file support (populate recordIds)
    const patientCase = await ReviewCase.findById(caseId)
      .populate('recordIds', 'title category reportDate')
      .populate('doctorId', 'name specialization')
      .lean();

    // 2. 🛡️ Null check FIRST to prevent server crash
    if (!patientCase) {
      console.log("❌ DB: Case ID not found in ReviewCase collection");
      return res.status(404).json({ success: false, message: "Case ID not found." });
    }

    // 3. 🛡️ Ownership check
    const isOwner = patientCase.patientId.toString() === req.user._id.toString();
    console.log(`🔐 IDs: Owner(${patientCase.patientId}) vs Requester(${req.user._id})`);

    if (!isOwner) {
      console.log("❌ Security: User does not own this case");
      return res.status(403).json({ success: false, message: "Unauthorized access." });
    }

    // 4. Calculate UI Steps for Step 3 Progress
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
    console.error("🔥 Controller Error:", error.message);
    res.status(500).json({ success: false, message: "Server error tracking case." });
  }
};

/**
 * @desc    Get all cases for history screen
 * @route   GET /api/patient/history
 * @access  Private (Patient)
 */
exports.getReviewHistory = async (req, res) => {
  try {
    const cases = await ReviewCase.find({ patientId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ success: true, data: cases });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Stream File Content Securely
 * @route   GET /api/patient/view/:id
 * @access  Private (Patient/Doctor)
 */
/**
 * @desc    Stream File Content Securely for Patients and Doctors
 * @route   GET /api/patient/view/:id
 * @access  Private (Patient/Doctor)
 */
exports.viewLocalFile = async (req, res) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: "Record not found." });
    }

    const userId = req.user._id.toString();
    const userRole = req.user.role; // Assuming 'role' is in your User model/JWT

    // 1. Ownership Check (Patient)
    const isOwner = record.userId.toString() === userId;

    // 2. Authorization Check (Doctor)
    let isAuthorizedDoctor = false;
    if (userRole === 'doctor') {
      // Check if this specific record is part of a case assigned to this doctor
      // OR if the doctor is simply authorized to view pending cases
      const associatedCase = await ReviewCase.findOne({
        recordIds: record._id,
        $or: [
          { doctorId: userId },
          { status: 'PENDING_DOCTOR' } // Doctors can view records for cases awaiting review
        ]
      });
      if (associatedCase) isAuthorizedDoctor = true;
    }

    // 🛡️ Final Security Gate
    if (!isOwner && !isAuthorizedDoctor) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    // 3. Stream the file
    res.set('Content-Type', record.contentType);
    res.send(record.fileData);

  } catch (error) {
    console.error("File View Error:", error);
    res.status(500).json({ success: false, message: "Error loading file." });
  }
};