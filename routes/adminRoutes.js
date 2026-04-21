const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * 🔒 SECURITY LAYER
 * All routes below this line require a valid JWT 
 * and the user must have the 'admin' role.
 */
router.use(protect);
router.use(authorize('admin'));

// --- User & Doctor Management ---
router.post('/create-doctor', adminController.createDoctor);
router.get('/users', adminController.getAllUsers); // Supports ?role=doctor or ?role=patient

// --- Dashboard & Insights ---
router.get('/dashboard-stats', adminController.getAdminDashboard);

// --- Clinical Case Control ---
router.get('/cases', adminController.getAllCases);
router.patch('/reassign-doctor', adminController.assignDoctorToCase);

// --- Financial Management ---
router.get('/payments', adminController.getTransactions);
router.patch('/verify-payment', adminController.verifyPaymentManually);

module.exports = router;