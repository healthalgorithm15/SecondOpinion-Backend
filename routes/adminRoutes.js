const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const caseCtrl = require('../controllers/caseController'); // Added for cross-functional case logic
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * 🔒 SECURITY LAYER
 * All routes below this line require a valid JWT 
 * and the user must have the 'admin' role.
 */
router.use(protect);
router.use(authorize('admin'));

// --- User & Doctor Management ---
/**
 * @route   POST /api/admin/create-doctor
 * @desc    Onboard new specialist doctors to the platform
 */
router.post('/create-doctor', adminController.createMedicalStaff);

/**
 * @route   GET /api/admin/users
 * @desc    Fetch all users (Supports query: ?role=doctor, ?role=patient, or ?role=cmo)
 */
router.get('/users', adminController.getAllUsers);

// --- Dashboard & Insights ---
/**
 * @route   GET /api/admin/dashboard-stats
 * @desc    High-level metrics (Total cases, revenue, active doctors)
 */
router.get('/dashboard-stats', adminController.getAdminDashboard);

// --- Clinical Case Control ---
/**
 * @route   GET /api/admin/cases
 * @desc    Fetch all cases across the system for monitoring
 */
router.get('/cases', adminController.getAllCases);

/**
 * @route   PATCH /api/admin/reassign-doctor
 * @desc    Override assignment if a specialist is unavailable
 */
router.patch('/reassign-doctor', adminController.assignDoctorToCase);

/**
 * @route   POST /api/admin/start-analysis/:caseId
 * @desc    Manual trigger to restart AI processing if background job fails
 */
router.post('/start-analysis/:caseId', caseCtrl.startCaseAnalysis);

// --- Financial Management ---
/**
 * @route   GET /api/admin/payments
 * @desc    Audit trail of all transactions
 */
router.get('/payments', adminController.getTransactions);

/**
 * @route   PATCH /api/admin/verify-payment
 * @desc    Manually approve a payment (e.g., bank transfer or gateway delay)
 */
router.patch('/verify-payment', adminController.verifyPaymentManually);

module.exports = router;