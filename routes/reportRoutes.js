const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

// ==========================================
// 👑 CONSOLIDATED HUMAN REVIEW (DOCTOR + CMO BUNDLE)
// ==========================================

// Catch-all patterns to map your base server path configurations seamlessly
router.get('/pdf-final/:caseId', reportController.getDoctorReviewPDF);
router.get('/case/pdf-final/:caseId', reportController.getDoctorReviewPDF);
router.get('/patient/case/pdf-final/:caseId', reportController.getDoctorReviewPDF);


// ==========================================
// 🤖 AI PRELIMINARY INSIGHTS 
// ==========================================
router.get('/pdf-ai/:caseId', reportController.getAIAnalysisPDF);
router.get('/case/pdf-ai/:caseId', reportController.getAIAnalysisPDF);
router.get('/patient/case/pdf-ai/:caseId', reportController.getAIAnalysisPDF);


// 🔄 BACKWARD COMPATIBILITY MATCH
router.get('/download/:type/:caseId', (req, res) => {
    const { type } = req.params;
    if (type === 'ai') {
        return reportController.getAIAnalysisPDF(req, res);
    } else {
        return reportController.getDoctorReviewPDF(req, res);
    }
});

module.exports = router;