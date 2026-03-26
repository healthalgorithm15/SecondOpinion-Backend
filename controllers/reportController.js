const PDFDocument = require('pdfkit');
const ReviewCase = require('../models/ReviewCase');

/**
 * 🤖 IMPROVED AI ANALYSIS PDF
 */
exports.getAIAnalysisPDF = async (req, res) => {
    try {
        const { caseId } = req.params;
        const caseData = await ReviewCase.findById(caseId);

        if (!caseData) return res.status(404).json({ success: false, message: 'Case not found.' });

        const doc = new PDFDocument({ size: 'LETTER', margin: 50 }); 

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=PramanAI_AI_Report_${caseId.slice(-6)}.pdf`);
        doc.pipe(res);

        // --- 1. HEADER BANNER ---
        doc.rect(0, 0, 612, 100).fill('#F0F9F8'); 
        doc.fillColor('#1E7D75').font('Helvetica-Bold').fontSize(24).text('Praman AI', 50, 35);
        doc.fillColor('#64748B').font('Helvetica').fontSize(10).text('PRELIMINARY CLINICAL CONTEXT', 50, 65);
        
        // --- 2. CASE INFO STRIP ---
        doc.rect(0, 100, 612, 35).fill('#1E7D75');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9).text(`CASE ID: ${caseId.toUpperCase()}`, 50, 112);
        // Use a fixed X coordinate for the date to avoid layout shifts
        doc.text(`GENERATED: ${new Date().toLocaleDateString()}`, 400, 112, { align: 'right', width: 162 });

        // --- 3. RISK ASSESSMENT SECTION ---
        // Explicitly set the Y coordinate after the header
        let currentY = 160;
        const risk = (caseData.aiAnalysis?.riskLevel || 'Low').toUpperCase();
        const riskColor = risk === 'HIGH' ? '#E11D48' : (risk === 'MEDIUM' ? '#F59E0B' : '#1E7D75');
        
        doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(10).text('RISK STATUS:', 50, currentY);
        doc.fillColor(riskColor).fontSize(14).text(risk, 50, currentY + 15);
        
        currentY += 45;
        // Horizontal Divider
        doc.moveTo(50, currentY).lineTo(562, currentY).strokeColor('#E2E8F0').lineWidth(1).stroke();
        
        // --- 4. EXECUTIVE SUMMARY ---
        currentY += 30;
        doc.fillColor('#1E7D75').font('Helvetica-Bold').fontSize(16).text('AI Executive Summary', 50, currentY);
        
        currentY += 25;
        const summaryText = caseData.aiAnalysis?.summary || "Automated analysis is being finalized. Please review the clinical records manually in the interim.";
        
        doc.fillColor('#334155').font('Helvetica').fontSize(11).text(
            summaryText, 
            50, // X position back to left margin
            currentY, 
            { width: 512, align: 'justify', lineGap: 5 }
        );

        // --- 5. FOOTER (Fixed at bottom) ---
        const footerY = 730;
        doc.moveTo(50, footerY).lineTo(562, footerY).strokeColor('#E2E8F0').lineWidth(1).stroke();
        doc.fontSize(8).fillColor('#94A3B8').text(
            'IMPORTANT: This document is an automated preliminary analysis designed to assist clinical review. It does not constitute a final diagnosis or medical prescription.',
            50, footerY + 15, { width: 512, align: 'center', lineGap: 2 }
        );

        doc.end();
    } catch (err) {
        console.error(err);
        res.status(500).send('Error generating AI PDF');
    }
};

/**
 * 👨‍⚕️ IMPROVED DOCTOR REVIEW PDF
 */
exports.getDoctorReviewPDF = async (req, res) => {
    try {
        const { caseId } = req.params;
        const reviewData = await ReviewCase.findById(caseId).populate('doctorId', 'name');

        if (!reviewData || reviewData.status !== 'COMPLETED') {
            return res.status(400).json({ success: false, message: 'Review not finalized.' });
        }

        const doc = new PDFDocument({ size: 'LETTER', margin: 50 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Specialist_Verdict_${caseId}.pdf`);
        doc.pipe(res);

        // --- 1. PROFESSIONAL LETTERHEAD ---
        doc.fillColor('#1E7D75').font('Helvetica-Bold').fontSize(26).text('Praman AI', { align: 'left' });
        doc.fontSize(10).fillColor('#64748B').text('Clinical Consultation Services', { align: 'left' });
        
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor('#1E7D75').lineWidth(2).stroke();
        doc.moveDown(2);

        // --- 2. DETAILS GRID ---
        const startY = doc.y;
        doc.fillColor('#64748B').font('Helvetica').fontSize(9).text('REVIEWING SPECIALIST', 50, startY);
        doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(12).text(`Dr. ${reviewData.doctorId?.name || 'Medical Specialist'}`, 50, startY + 15);

        doc.fillColor('#64748B').font('Helvetica').fontSize(9).text('CASE REFERENCE', 350, startY);
        doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(12).text(caseId.toUpperCase(), 350, startY + 15);

        doc.y = startY + 50;
        doc.moveDown(2);

        // --- 3. FINAL VERDICT SECTION ---
        doc.fillColor('#1E7D75').font('Helvetica-Bold').fontSize(14).text('FINAL CLINICAL VERDICT');
        doc.moveDown(0.5);
        
        // Background box for emphasis
        const verdictText = reviewData.doctorOpinion?.finalVerdict || "No verdict recorded.";
        const textHeight = doc.heightOfString(verdictText, { width: 480 });
        
        doc.rect(50, doc.y, 512, textHeight + 20).fill('#F8FAFC');
        doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(12).text(verdictText, 65, doc.y + 10, { width: 480 });

        doc.y += textHeight + 40;

        // --- 4. RECOMMENDATIONS ---
        doc.fillColor('#1E7D75').font('Helvetica-Bold').fontSize(14).text('RECOMMENDATIONS & NEXT STEPS');
        doc.moveDown(0.8);
        doc.fillColor('#334155').font('Helvetica').fontSize(11).text(
            reviewData.doctorOpinion?.recommendations || "Follow standard clinical protocols for the identified condition.",
            { width: 512, lineGap: 5, align: 'justify' }
        );

        // --- 5. DIGITAL SIGNATURE ---
        const bottomY = 700;
        doc.moveTo(350, bottomY).lineTo(550, bottomY).strokeColor('#CBD5E1').lineWidth(1).stroke();
        doc.fontSize(8).fillColor('#94A3B8').text('Digitally Signed by verified Medical Specialist', 350, bottomY + 5, { width: 200, align: 'center' });
        doc.text(`Verification Date: ${new Date().toLocaleDateString()}`, 350, bottomY + 18, { width: 200, align: 'center' });

        doc.end();
    } catch (err) {
        console.error(err);
        res.status(500).send('Error generating Doctor PDF');
    }
};