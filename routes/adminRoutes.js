// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const { createDoctor } = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Chain the middlewares: 
// 1. protect (is the token valid?) 
// 2. authorize('admin') (is the user an admin?)
router.post('/create-doctor', protect, authorize('admin'), createDoctor);

module.exports = router;