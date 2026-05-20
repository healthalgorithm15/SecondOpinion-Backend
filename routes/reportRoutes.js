const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

// 🤖 Isolated Machine Layer
// Matches frontend request: /api/patient/case/pdf-ai/:caseId
router.get('/case/pdf-ai/:caseId', reportController.getAIAnalysisPDF);

// 👨‍⚕️ 👑 Combined Human Verification Layer (Doctor + CMO Bundle)
// Matches frontend request: /api/patient/case/pdf-final/:caseId
router.get('/case/pdf-final/:caseId', reportController.getDoctorReviewPDF);

// 🔄 Backward Compatibility Layer (Just in case)
router.get('/download/:type/:caseId', (req, res) => {
    const { type } = req.params;
    if (type === 'ai') {
        return reportController.getAIAnalysisPDF(req, res);
    } else {
        return reportController.getDoctorReviewPDF(req, res);
    }
});

module.exports = router;