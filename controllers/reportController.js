const PDFDocument = require('pdfkit');
const ReviewCase = require('../models/ReviewCase');

exports.getAIAnalysisPDF = async (req, res) => {
    try {
        const { caseId } = req.params; 
        const caseData = await ReviewCase.findById(caseId);

        if (!caseData) {
            return res.status(404).json({ success: false, message: 'Case not found.' });
        }

        const doc = new PDFDocument({ margin: 50 });
        
        // 🟢 FIX: Set to 'inline' so the In-App Preview works
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=AI_Analysis_${caseId}.pdf`);
        
        doc.pipe(res);

        // Header Section with MedTech Teal
        doc.fontSize(20).fillColor('#1E7D75').font('Helvetica-Bold').text('AI Preliminary Analysis', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#7f8c8d').font('Helvetica').text(`Case ID: ${caseId}`, { align: 'center' });
        doc.text(`Risk Level: ${caseData.aiAnalysis?.riskLevel || 'N/A'}`, { align: 'center' });
        doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#ecf0f1').stroke();
        
        doc.moveDown(2);

        doc.fontSize(14).fillColor('#1E7D75').font('Helvetica-Bold').text('AI Summary:');
        doc.moveDown(0.5);
        doc.fontSize(12).fillColor('#334155').font('Helvetica').text(
            caseData.aiAnalysis?.summary || "AI processing is still in progress."
        );

        doc.end();
    } catch (err) {
        res.status(500).send('Error generating AI PDF');
    }
};

exports.getDoctorReviewPDF = async (req, res) => {
    try {
        const { caseId } = req.params;
        const reviewData = await ReviewCase.findById(caseId).populate('doctorId', 'name');

        if (!reviewData || reviewData.status !== 'COMPLETED') {
            return res.status(400).json({ success: false, message: 'Review not finalized.' });
        }

        const doc = new PDFDocument({ margin: 50 });
        
        // 🟢 FIX: Set to 'inline'
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Specialist_Verdict_${caseId}.pdf`);
        
        doc.pipe(res);

        doc.fontSize(22).fillColor('#1E7D75').font('Helvetica-Bold').text('Specialist Clinical Verdict', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).fillColor('#2c3e50').font('Helvetica').text(`Reviewing Dr: ${reviewData.doctorId?.name || 'Medical Specialist'}`);
        doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#1E7D75').stroke();
        
        doc.moveDown(2);
        doc.fontSize(14).fillColor('#1E7D75').font('Helvetica-Bold').text('Final Verdict:');
        doc.fontSize(12).fillColor('#000').text(reviewData.doctorOpinion?.finalVerdict || "N/A");

        doc.end();
    } catch (err) {
        res.status(500).send('Error generating Specialist PDF');
    }
};
module.exports = {
    getAIAnalysisPDF: exports.getAIAnalysisPDF,
    getDoctorReviewPDF: exports.getDoctorReviewPDF
};