const express = require('express');
const router = express.Router();

// 🎮 Controller Imports
const { 
    getDashboard, 
    uploadRecord, 
    viewLocalFile,
    submitReview,
    getCaseStatus,
    getReviewHistory,
    deleteRecord,
    reuseRecord // 🟢 NEW: Added for History Reuse functionality
} = require('../controllers/patientController');

const { 
    getAIAnalysisPDF, 
    getDoctorReviewPDF 
} = require('../controllers/reportController');

// 🛡️ Middleware imports
const { protect } = require('../middleware/authMiddleware'); 
const { apiLimiter } = require('../middleware/rateLimiter');
const upload = require('../middleware/uploadMiddleware');

// Log all incoming requests to this router for debugging
router.use((req, res, next) => {
  console.log("🚀 Request received in PatientRoutes:", req.method, req.url);
  next();
});

// 🔒 Apply protection to all routes below this line
router.use(protect);

/**
 * @route   GET /api/patient/dashboard
 * @desc    Fetches user profile, drafts (Scenario 2), and active cases (Scenario 3)
 */
router.get('/dashboard', apiLimiter, getDashboard);

/**
 * @route   POST /api/patient/upload
 * @desc    Handles initial multipart file uploads (Scenario 1)
 */
router.post('/upload', upload.single('file'), uploadRecord);

/**
 * @route   POST /api/patient/records/reuse
 * @desc    🟢 NEW: Adds a document from medical vault/history to current drafts
 */
router.post('/records/reuse', apiLimiter, reuseRecord);

/**
 * @route   POST /api/patient/submit-review
 * @desc    Transitions Drafts to an Active Case (Scenario 2 -> 3)
 */
router.post('/submit-review', apiLimiter, submitReview);

/**
 * @route   GET /api/patient/case/:caseId
 * @desc    Allows frontend to poll for AI status or Doctor progress
 */
router.get('/case/:caseId', apiLimiter, getCaseStatus);

/**
 * @route   GET /api/patient/view/:id
 * @desc    Streams the binary file (Buffer) or returns URL for viewing
 */
router.get('/view/:id', apiLimiter, viewLocalFile);

/**
 * @route   GET /api/patient/history
 * @desc    Fetches all completed and past cases for the Medical Vault
 */
router.get('/history', apiLimiter, getReviewHistory);

/**
 * @route   DELETE /api/patient/record/:id
 * @desc    Deletes a record (Only allowed if isSubmitted is false)
 */
router.delete('/record/:id', deleteRecord);

/**
 * @route   GET /api/patient/case/pdf-ai/:caseId
 * @desc    Generates/Fetches PDF for AI Analysis results
 */
router.get('/case/pdf-ai/:caseId', getAIAnalysisPDF);

/**
 * @route   GET /api/patient/case/pdf-doctor/:caseId
 * @desc    Generates/Fetches PDF for Doctor's Final Verdict
 */
router.get('/case/pdf-doctor/:caseId', getDoctorReviewPDF);

module.exports = router;