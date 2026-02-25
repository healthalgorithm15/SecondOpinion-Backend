const express = require('express');
const router = express.Router();
const { 
    getDashboard, 
    uploadRecord, 
    viewLocalFile,
    submitReview,
    getCaseStatus // 🚀 Added to track AI progress for Step 3
} = require('../controllers/patientController');
const reportController = require('../controllers/reportController');

// 🛡️ Middleware imports
const { protect } = require('../middleware/authMiddleware'); 
const { apiLimiter } = require('../middleware/rateLimiter');
const upload = require('../middleware/uploadMiddleware');

// Apply protection to all routes in this router
// This ensures req.user is populated for every request
router.use(protect);

/**
 * @route   GET /api/patient/dashboard
 * Fetches user profile and report list for Step 1
 * 
 */

router.use((req, res, next) => {
  console.log("🚀 Request received in PatientRoutes:", req.method, req.url);
  next();
});
router.get('/dashboard', apiLimiter, getDashboard);

/**
 * @route   POST /api/patient/upload
 * Handles multipart file uploads and maps to schema
 */
router.post('/upload', upload.single('file'), uploadRecord);

/**
 * @route   POST /api/patient/submit-review
 * 🚀 Connects Step 1 to Step 2: Creates Case and triggers AI
 */
router.post('/submit-review', apiLimiter, submitReview);

/**
 * @route   GET /api/patient/case/:id
 * 🚀 New Route: Connects Step 2 to Step 3. 
 * Allows the frontend to poll for AI status updates
 */
router.get('/case/:caseId', apiLimiter, getCaseStatus);

/**
 * @route   GET /api/patient/view/:id
 * Streams the binary file from MongoDB
 */
router.get('/view/:id', apiLimiter, viewLocalFile);
router.get('/case/pdf-ai/:caseId', protect, reportController.getAIAnalysisPDF);
router.get('/case/pdf-doctor/:caseId', protect, reportController.getDoctorReviewPDF);

module.exports = router;