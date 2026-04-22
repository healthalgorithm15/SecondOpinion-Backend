const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware'); 
const doctorCtrl = require('../controllers/doctorController');
const caseCtrl = require('../controllers/caseController');

/**
 * 🛡️ Role-Based Access Control Middleware
 */
const authorizeMedicalStaff = (req, res, next) => {
    const role = req.user?.role?.toLowerCase();
    if (['doctor', 'cmo', 'admin'].includes(role)) {
        return next();
    }
    return res.status(403).json({ 
        success: false, 
        message: "Access Denied: Medical credentials required." 
    });
};

// --- PROTECT ALL ROUTES ---
router.use(protect);                
router.use(authorizeMedicalStaff);  

/**
 * @route   GET /api/doctor/pending-cases
 * @desc    CMO sees all, Doctor sees assigned.
 * 🟢 FIXED: Points to doctorCtrl.getPendingCases
 */
router.get('/pending-cases', doctorCtrl.getPendingCases);

/**
 * @route   PUT /api/doctor/assign
 * @desc    CMO assigns a case to a specific doctor
 */
router.put('/assign', authorize('cmo', 'admin'), caseCtrl.assignCase);

/**
 * @route   GET /api/doctor/case/:caseId
 */
router.get('/case/:caseId', doctorCtrl.getCaseById);

/**
 * @route   POST /api/doctor/submit-opinion
 */
router.post('/submit-opinion', authorize('doctor', 'admin'), doctorCtrl.submitOpinion);

/**
 * @route   GET /api/doctor/history
 */
router.get('/history', doctorCtrl.getDoctorHistory);

/**
 * @route   POST /api/doctor/cmo-approve
 */
router.post('/cmo-approve', authorize('cmo', 'admin'), caseCtrl.cmoFinalApproval);

module.exports = router;