const MedicalRecord = require('../models/MedicalRecord');
const ReviewCase = require('../models/ReviewCase');
const Transaction = require('../models/Transaction'); 
const aiService = require('../services/aiService');
const config = require('../config');
const mongoose = require('mongoose');

/**
 * @desc    Get Patient Dashboard (Dynamic Scenario Handling)
 * @route   GET /api/patient/dashboard
 */
exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user._id;
    // 🟢 PRODUCTION FIX: Prepare both ID types to match the database (String vs ObjectId)
    const patientObjectId = userId;
    const patientStringId = userId.toString();

    // 1. SCENARIO 2: Fetch Drafts (Uploaded but not yet submitted)
    const draftReports = await MedicalRecord.find({ 
      userId, 
      isSubmitted: false 
    })
      .select('title category reportDate createdAt contentType fileName')
      .sort({ createdAt: -1 })
      .lean();

    // 2. SCENARIO 3: Fetch Active Case (Under Review)
    const activeCase = await ReviewCase.findOne({ 
      patientId: userId, 
      status: { $in: ['AI_PROCESSING', 'PENDING_DOCTOR', 'COMPLETED'] } 
    })
      .populate('recordIds', 'title category')
      .populate('doctorId', 'name specialization')
      .sort({ createdAt: -1 })
      .lean();

    /**
     * 🟢 PRODUCTION FIX: Robust Credit Check
     * Matches the ID whether it was stored as a String (as seen in your screenshot) 
     * or a proper ObjectId.
     */
    const unusedPayment = await Transaction.findOne({
      patientId: { $in: [patientObjectId, patientStringId] },
      status: 'paid',
      $or: [
        { scanId: null },
        { scanId: 'new_scan' },
        { scanId: { $exists: false } }
      ]
    }).sort({ paidAt: -1 });

    // Format draft reports with viewing URLs
    const formattedDrafts = draftReports.map(r => ({
      ...r,
      _id: r._id.toString(),
      displayUrl: `${config.appUrl}/api/patient/view/${r._id}`
    }));

    res.status(200).json({ 
      success: true, 
      data: { 
        user: { name: req.user.name, _id: userId },
        reports: formattedDrafts, 
        activeCase: activeCase,   
        hasActivePayment: !!unusedPayment, 
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
  const userId = req.user._id;
  const session = await mongoose.startSession();
  
  try {
    let newCaseId;
    // 🟢 PRODUCTION FIX: Define IDs for the transaction scope
    const patientObjectId = userId;
    const patientStringId = userId.toString();

    await session.withTransaction(async () => {
      // 1. Verify ownership of records
      const ownedRecords = await MedicalRecord.find({ 
        _id: { $in: reportIds }, 
        userId: userId 
      }).session(session);

      if (ownedRecords.length !== reportIds.length) {
        throw new Error("UNAUTHORIZED_ACCESS");
      }

      // 2. Verify and Consume Payment Credit (using robust ID check)
      const paymentCredit = await Transaction.findOne({
        patientId: { $in: [patientObjectId, patientStringId] },
        status: 'paid',
        $or: [
          { scanId: null },
          { scanId: 'new_scan' },
          { scanId: { $exists: false } }
        ]
      }).session(session);

      if (!paymentCredit) {
        throw new Error("NO_ACTIVE_PAYMENT");
      }

      // 3. Create the Review Case
      const newCase = new ReviewCase({ 
        patientId: userId, 
        recordIds: reportIds, 
        status: 'AI_PROCESSING' 
      });
      await newCase.save({ session });
      newCaseId = newCase._id;

      // 4. Link the payment to this specific case so it's "used"
      paymentCredit.scanId = newCaseId;
      await paymentCredit.save({ session });

      // 5. Mark records as submitted
      await MedicalRecord.updateMany(
        { _id: { $in: reportIds } }, 
        { $set: { isSubmitted: true } }, 
        { session }
      );
    });

    // 6. Socket.io Emit
    if (global.io) {
      global.io.to('doctor').emit('new_case_submitted', { 
        caseId: newCaseId, 
        patientName: req.user.name 
      });
    }

    // 7. Trigger AI Analysis
    aiService.analyzeReports(newCaseId); 

    res.status(200).json({ success: true, caseId: newCaseId });
  } catch (error) {
    console.error("Submit Review Error:", error);
    const status = error.message === "NO_ACTIVE_PAYMENT" ? 402 : 500;
    res.status(status).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Reuse a record from the Medical Vault
 */
exports.reuseRecord = async (req, res) => {
  try {
    const { reportId } = req.body;
    const userId = req.user._id;

    const original = await MedicalRecord.findById(reportId);
    if (!original) return res.status(404).json({ success: false, message: "Record not found." });

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
 * @desc    Upload Medical Record
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
      aiCompleted: !['AI_PROCESSING'].includes(patientCase.status), 
      doctorStarted: !!patientCase.doctorId || patientCase.status === 'COMPLETED' 
    };

    res.status(200).json({ success: true, data: { ...patientCase, uiSteps } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error tracking case." });
  }
};

/**
 * @desc    View Medical Document
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
 * @desc    Delete a record
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
 * @desc    Fetch Case History
 */
exports.getReviewHistory = async (req, res) => {
  try {
    const query = { patientId: req.user._id };
    const cases = await ReviewCase.find(query)
      .populate('recordIds', 'title fileName contentType createdAt')
      .populate('doctorId', 'name specialization')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ success: true, data: cases });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching history." });
  }
};