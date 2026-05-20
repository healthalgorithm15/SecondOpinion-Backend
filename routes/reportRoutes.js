const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

// 🚀 Option A: Clean, Direct Semantic Endpoints (Used by our updated CaseSummary)
router.get('/pdf-ai/:caseId', reportController.getAIAnalysisPDF);
router.get('/pdf-final/:caseId', reportController.getDoctorReviewPDF);

// 🔄 Option B: Backward Compatibility Layer (Handles your original pattern flawlessly)
router.get('/download/:type/:caseId', (req, res) => {
    const { type } = req.params;
    
    if (type === 'ai') {
        return reportController.getAIAnalysisPDF(req, res);
    } else {
        // Both 'doctor' and 'cmo' types now automatically route to the unified human bundle
        return reportController.getDoctorReviewPDF(req, res);
    }
});

module.exports = router;