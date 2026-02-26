const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware'); 
const doctorCtrl = require('../controllers/doctorController');


/**
 * 🛡️ Role-Based Access Control Middleware
 * Ensures the logged-in user is actually a specialist.
 */
const authorizeDoctor = (req, res, next) => {
    // We use .toLowerCase() to prevent case-sensitive mismatches (e.g., 'Doctor' vs 'doctor')
    if (req.user && req.user.role.toLowerCase() === 'doctor') {
        return next();
    }
    return res.status(403).json({ 
        success: false, 
        message: "Access Denied: You do not have the medical credentials to view this page." 
    });
};

// --- PROTECT ALL DOCTOR ROUTES ---
router.use(protect);          // Step 1: Must be logged in (JWT check)
router.use(authorizeDoctor); // Step 2: Must be a specialist

/**
 * @route   GET /api/doctor/pending-cases
 * @desc    Fetch cases that have completed AI analysis and need a human doctor
 */
router.get('/pending-cases', doctorCtrl.getPendingCases);
router.get('/case/:caseId', doctorCtrl.getCaseById);
/**
 * @route   POST /api/doctor/submit-opinion
 * @desc    Specialist submits the final medical verdict for a case
 */
router.post('/submit-opinion', doctorCtrl.submitOpinion);

router.get('/history', doctorCtrl.getDoctorHistory);
module.exports = router;