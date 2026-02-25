const PDFDocument = require('pdfkit');
const ReviewCase = require('../models/ReviewCase');

/**
 * 🤖 GENERATE AI ANALYSIS PDF
 * @route   GET /api/patient/case/pdf-ai/:caseId
 * @access  Private (Patient/Doctor)
 */
exports.getAIAnalysisPDF = async (req, res) => {
    try {
        const { caseId } = req.params; 
        
        // Find the record using the ReviewCase model
        const caseData = await ReviewCase.findById(caseId);

        if (!caseData) {
            return res.status(404).json({ success: false, message: 'Case not found.' });
        }

        const doc = new PDFDocument({ margin: 50 });
        
        // Set Headers for File Download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=AI_Analysis_${caseId}.pdf`);
        
        doc.pipe(res);

        // Header Section
        doc.fontSize(20).fillColor('#2c3e50').font('Helvetica-Bold').text('AI Preliminary Analysis', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#7f8c8d').text(`Case ID: ${caseId}`, { align: 'center' });
        doc.text(`Risk Level: ${caseData.aiAnalysis?.riskLevel || 'N/A'}`, { align: 'center' });
        doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#ecf0f1').stroke();
        
        doc.moveDown(2);

        // AI Summary Section
        doc.fontSize(14).fillColor('#2c3e50').font('Helvetica-Bold').text('AI Summary:');
        doc.moveDown(0.5);
        doc.fontSize(12).fillColor('#34495e').font('Helvetica').text(
            caseData.aiAnalysis?.summary || "AI processing is still in progress or failed. Manual review required."
        );

        // Extracted Markers Section
        if (caseData.aiAnalysis?.extractedMarkers?.length > 0) {
            doc.moveDown();
            doc.fontSize(14).font('Helvetica-Bold').text('Detected Markers:');
            caseData.aiAnalysis.extractedMarkers.forEach(marker => {
                doc.fontSize(12).font('Helvetica').text(`• ${marker}`);
            });
        }

        // Footer Note
        doc.moveDown(4);
        doc.fontSize(10).fillColor('#95a5a6').text('Disclaimer: This is an AI-generated summary for preliminary context. Please refer to the Specialist Clinical Verdict for final medical decisions.', { align: 'center', italic: true });

        doc.end();
    } catch (err) {
        console.error("❌ AI PDF Error:", err);
        res.status(500).send('Error generating AI PDF');
    }
};

/**
 * 👨‍⚕️ GENERATE DOCTOR REVIEW PDF
 * @route   GET /api/patient/case/pdf-doctor/:caseId
 * @access  Private (Patient/Doctor)
 */
exports.getDoctorReviewPDF = async (req, res) => {
    try {
        const { caseId } = req.params;

        // Populate doctorId to get their name from the User collection
        const reviewData = await ReviewCase.findById(caseId).populate('doctorId', 'name');

        if (!reviewData) {
            return res.status(404).json({ success: false, message: 'Case not found.' });
        }

        // Logic check: Only allow download if the status is COMPLETED
        if (reviewData.status !== 'COMPLETED') {
            return res.status(400).json({ success: false, message: 'Review is still pending specialist finalization.' });
        }

        const doc = new PDFDocument({ margin: 50 });
        
        // Set Headers for File Download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Specialist_Verdict_${caseId}.pdf`);
        
        doc.pipe(res);

        // Specialist Header
        doc.fontSize(22).fillColor('#1E7D75').font('Helvetica-Bold').text('Specialist Clinical Verdict', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).fillColor('#2c3e50').font('Helvetica').text(`Reviewing Dr: ${reviewData.doctorId?.name || 'Medical Specialist'}`);
        doc.moveDown().moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#1E7D75').stroke();
        
        doc.moveDown(2);

        // Verdict Section
        doc.fontSize(14).fillColor('#1E7D75').font('Helvetica-Bold').text('Final Verdict:');
        doc.fontSize(12).fillColor('#000').font('Helvetica').text(
            reviewData.doctorOpinion?.finalVerdict || "Verdict pending recording."
        );
        
        doc.moveDown(1.5);

        // Recommendations Section
        doc.fontSize(14).fillColor('#1E7D75').font('Helvetica-Bold').text('Clinical Recommendations:');
        doc.fontSize(12).fillColor('#000').font('Helvetica').text(
            reviewData.doctorOpinion?.recommendations || "Please follow standard protocols as discussed."
        );

        // Authentication Footer
        doc.moveDown(4);
        doc.fontSize(10).fillColor('#bdc3c7').text(`Digitally signed on ${new Date().toLocaleDateString()}`, { align: 'right' });

        doc.end();
    } catch (err) {
        console.error("❌ Doctor PDF Error:", err);
        res.status(500).send('Error generating Specialist PDF');
    }
};