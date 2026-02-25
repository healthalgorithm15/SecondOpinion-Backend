const ReviewCase = require('../models/ReviewCase');
const aiService = require('../services/aiService');

exports.startCaseAnalysis = async (req, res) => {
  try {
    const { caseId } = req.params;

    // 1. Instantly set status to PROCESSING
    await ReviewCase.findByIdAndUpdate(caseId, { status: 'PROCESSING' });

    // 2. 🚀 FIRE AND FORGET
    // Notice there is NO 'await' here. The AI starts in the background.
    aiService.analyzeReports(caseId);

    // 3. Respond to Mobile App immediately
    res.status(200).json({ success: true, message: "Analysis started" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};