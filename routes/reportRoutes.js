const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

// This single route handles both cases based on the "type" parameter
router.get('/download/:type/:reportId', (req, res) => {
    const { type } = req.params;
    
    if (type === 'ai') {
        return reportController.getAIAnalysisPDF(req, res);
    } else if (type === 'doctor') {
        return reportController.getDoctorReviewPDF(req, res);
    } else {
        return res.status(400).json({ message: "Invalid report type" });
    }
});

module.exports = router;