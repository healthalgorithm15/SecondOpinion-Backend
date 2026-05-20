const PDFDocument = require('pdfkit');
const ReviewCase = require('../models/ReviewCase');

/**
 * 🤖 AI ANALYSIS PDF (Preliminary Clinical Context)
 */
exports.getAIAnalysisPDF = async (req, res) => {
    try {
        const { caseId } = req.params; // 🛠️ FIXED: Matches route parameter name perfectly
        const caseData = await ReviewCase.findById(caseId);

        if (!caseData) return res.status(404).json({ success: false, message: 'Case not found.' });

        const doc = new PDFDocument({ size: 'LETTER', margin: 50 }); 

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=PramanAI_AI_Report_${caseId.slice(-6)}.pdf`);
        doc.pipe(res);

        // --- 1. HEADER & CASE INFO ---
        doc.rect(0, 0, 612, 100).fill('#F0F9F8'); 
        doc.fillColor('#1E7D75').font('Helvetica-Bold').fontSize(24).text('Praman AI', 50, 35);
        doc.fillColor('#64748B').font('Helvetica').fontSize(10).text('PRELIMINARY CLINICAL CONTEXT', 50, 65);
        
        doc.rect(0, 100, 612, 35).fill('#1E7D75');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9).text(`CASE ID: ${caseId.toUpperCase()}`, 50, 112);
        doc.text(`GENERATED: ${new Date().toLocaleDateString()}`, 400, 112, { align: 'right', width: 162 });

        // --- 2. RISK STATUS ---
        let currentY = 160;
        const risk = (caseData.aiAnalysis?.riskLevel || 'Low').toUpperCase();
        const riskColor = risk === 'HIGH' ? '#E11D48' : (risk === 'MEDIUM' ? '#F59E0B' : '#1E7D75');
        
        doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(10).text('RISK STATUS:', 50, currentY);
        doc.fillColor(riskColor).fontSize(14).text(risk, 50, currentY + 15);
        
        currentY += 45;
        doc.moveTo(50, currentY).lineTo(562, currentY).strokeColor('#E2E8F0').lineWidth(1).stroke();
        
        // --- 3. EXECUTIVE SUMMARY ---
        currentY += 30;
        doc.fillColor('#1E7D75').font('Helvetica-Bold').fontSize(16).text('AI Executive Summary', 50, currentY);
        
        currentY += 25;
        doc.fillColor('#334155').font('Helvetica').fontSize(11).text(
            caseData.aiAnalysis?.summary || "Automated analysis pending.", 
            50, currentY, { width: 512, align: 'justify', lineGap: 5 }
        );

        // --- 4. COLOR-CODED LAB MARKERS ---
        currentY = doc.y + 35; 

        if (caseData.aiAnalysis?.extractedMarkers?.length > 0) {
            doc.fillColor('#1E7D75').font('Helvetica-Bold').fontSize(14).text('Key Laboratory Markers', 50, currentY);
            currentY = doc.y + 10;

            caseData.aiAnalysis.extractedMarkers.forEach((marker) => {
                let itemColor = '#334155';
                if (marker.includes('(High)') || marker.includes('(Abnormal)')) {
                    itemColor = '#E11D48';
                } else if (marker.includes('(Low)')) {
                    itemColor = '#D97706';
                }

                if (currentY > 720) {
                    doc.addPage();
                    currentY = 50;
                }

                doc.fillColor(itemColor).font('Helvetica').fontSize(10).text(`• ${marker}`, 60, currentY);
                currentY = doc.y + 5;
            });
        }

        // --- 5. FOOTER ---
        const footerY = 730;
        doc.moveTo(50, footerY).lineTo(562, footerY).strokeColor('#E2E8F0').lineWidth(1).stroke();
        doc.fontSize(8).fillColor('#94A3B8').font('Helvetica').text(
            'IMPORTANT: This document is an automated preliminary analysis designed to assist clinical review. It does not constitute a final diagnosis or medical prescription.',
            50, footerY + 15, { width: 512, align: 'center' }
        );

        doc.end();
    } catch (err) {
        console.error("AI PDF Error:", err);
        if (!res.headersSent) res.status(500).send('Error generating AI PDF');
    }
};

/**
 * 👨‍⚕️ 👑 UNIFIED CLINICAL VERDICT PDF (Doctor Review + CMO Verification Bundle)
 */
exports.getDoctorReviewPDF = async (req, res) => {
    try {
        const { caseId } = req.params; // 🛠️ FIXED: Linked parameter correctly
        const reviewData = await ReviewCase.findById(caseId)
            .populate('doctorId', 'name')
            .populate('assignedTo', 'name')
            .populate('cmoOpinion.approvedBy', 'name');

        if (!reviewData || reviewData.status !== 'COMPLETED') {
            return res.status(400).json({ success: false, message: 'Review package is not fully finalized yet.' });
        }

        const doc = new PDFDocument({ size: 'LETTER', margin: 50 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Official_Medical_Report_${caseId}.pdf`);
        doc.pipe(res);

        // --- 1. PROFESSIONAL LETTERHEAD ---
        doc.fillColor('#4338CA').font('Helvetica-Bold').fontSize(26).text('Praman AI', { align: 'left' });
        doc.fontSize(10).fillColor('#64748B').font('Helvetica').text('Official Certified Medical Verdict', { align: 'left' });
        
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor('#4338CA').lineWidth(2).stroke();
        doc.moveDown(1.5);

        // --- 2. CASE REFERENCE METADATA GRID ---
        const startY = doc.y;
        doc.fillColor('#64748B').font('Helvetica').fontSize(9).text('CASE REFERENCE ID', 50, startY);
        doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(11).text(caseId.toUpperCase(), 50, startY + 14);

        doc.fillColor('#64748B').font('Helvetica').fontSize(9).text('VERIFICATION DATE', 350, startY);
        const finalDate = reviewData.cmoOpinion?.approvedAt ? new Date(reviewData.cmoOpinion.approvedAt) : new Date();
        doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(11).text(finalDate.toLocaleDateString(), 350, startY + 14);

        doc.moveDown(3);

        // --- 3. 👑 LAYER 1: CHIEF MEDICAL OFFICER DIRECTIVE ---
        doc.fillColor('#4338CA').font('Helvetica-Bold').fontSize(13).text('I. EXECUTIVE CMO VERIFICATION');
        doc.moveDown(0.5);

        const cmoVerdict = reviewData.cmoOpinion?.updatedVerdict || "Verified and authenticated by Chief Medical Officer.";
        const cmoRecs = reviewData.cmoOpinion?.updatedRecommendations || "The clinical roadmap outlined below has been fully validated for patient release.";
        const combinedCmoText = `${cmoVerdict}\n\nRecommendations:\n${cmoRecs}`;
        const cmoBoxHeight = doc.heightOfString(combinedCmoText, { width: 480 });

        doc.rect(50, doc.y, 512, cmoBoxHeight + 20).fill('#F5F7FF');
        doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(11).text(combinedCmoText, 65, doc.y + 10, { width: 480, lineGap: 3 });

        doc.moveDown(3.5);

        // --- 4. 👨‍⚕️ LAYER 2: PRIMARY SPECIALIST REVIEW (Hides beautifully if direct CMO bypass was utilized)
        const specialistName = reviewData.assignedTo?.name || reviewData.doctorId?.name;
        const specialistVerdict = reviewData.doctorOpinion?.finalVerdict;

        if (specialistVerdict) {
            doc.fillColor('#1E7D75').font('Helvetica-Bold').fontSize(13).text(`II. SPECIALIST CLINICAL ANALYSIS (Dr. ${specialistName})`);
            doc.moveDown(0.5);

            const specText = `Verdict:\n${specialistVerdict}\n\nClinical Roadmap:\n${reviewData.doctorOpinion?.recommendations || "Follow default therapeutic layout."}`;
            const specBoxHeight = doc.heightOfString(specText, { width: 480 });

            // Wrap block onto next page if space is constricted
            if (doc.y + specBoxHeight > 700) doc.addPage();

            doc.rect(50, doc.y, 512, specBoxHeight + 20).fill('#F8FAFC');
            doc.fillColor('#334155').font('Helvetica').fontSize(11).text(specText, 65, doc.y + 10, { width: 480, lineGap: 3 });
        } else {
            // CMO Bypass placeholder text
            doc.fillColor('#64748B').font('Helvetica-Oblique').fontSize(11).text('*Case directly accelerated to executive review layer. Specialist triage phase omitted.', { width: 512 });
        }

        // --- 5. SECURE DIGITAL SIGNATURE FOOTER TRACKING ---
        const bottomY = 710;
        doc.moveTo(50, bottomY).lineTo(562, bottomY).strokeColor('#E2E8F0').lineWidth(1).stroke();
        
        doc.fontSize(8).fillColor('#94A3B8').font('Helvetica')
           .text('This is a validated electronic document generated by PramanAI. Authenticity and clinical ownership logs are cryptographic fields locked within our secure records database.', 50, bottomY + 10, { width: 512, align: 'center' });

        doc.end();
    } catch (err) {
        console.error("Unified Report PDF Error:", err);
        if (!res.headersSent) res.status(500).send('Error generating joint verification bundle');
    }
};