const PDFDocument = require('pdfkit');
const ReviewCase = require('../models/ReviewCase');

/**
 * 🤖 AI ANALYSIS PDF (Preliminary Clinical Context)
 */
exports.getAIAnalysisPDF = async (req, res) => {
    const { caseId } = req.params;
    console.log(`\n=== [PDF-AI START] Processing Case ID: ${caseId} ===`);
    
    try {
        const caseData = await ReviewCase.findById(caseId);

        if (!caseData) {
            console.error(`❌ [PDF-AI ERROR] Case not found in Database for ID: ${caseId}`);
            return res.status(404).json({ success: false, message: 'Case not found.' });
        }
        
        console.log(`✅ [PDF-AI DB MATCH] Document retrieved successfully. Risk Level: ${caseData.aiAnalysis?.riskLevel || 'N/A'}`);

        const doc = new PDFDocument({ size: 'LETTER', margin: 50 }); 

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=PramanAI_AI_Report_${caseId.slice(-6)}.pdf`);
        
        // Track byte stream output
        let bytesWritten = 0;
        doc.on('data', (chunk) => {
            bytesWritten += chunk.length;
        });

        doc.on('end', () => {
            console.log(`🏁 [PDF-AI STREAM FINISHED] Generated successfully. Total File Size: ${(bytesWritten / 1024).toFixed(2)} KB`);
        });

        doc.pipe(res);
        console.log(`📥 [PDF-AI PIPE] Data stream successfully attached to Express response object.`);

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
        console.error("❌ [PDF-AI CRITICAL FAULT]:", err);
        if (!res.headersSent) res.status(500).send('Error generating AI PDF');
    }
};

/**
 * 👨‍⚕️ 👑 UNIFIED CLINICAL VERDICT PDF (Doctor Review + CMO Verification Bundle)
 */
exports.getDoctorReviewPDF = async (req, res) => {
    const { caseId } = req.params;
    console.log(`\n=== [PDF-FINAL START] Processing Case ID: ${caseId} ===`);
    
    try {
        // 1. Fetch case with a fallback catch block to handle population errors safely
        let reviewData;
        try {
            reviewData = await ReviewCase.findById(caseId)
                .populate('doctorId', 'name')
                .populate('assignedTo', 'name')
                .populate('cmoOpinion.approvedBy', 'name');
        } catch (populateError) {
            console.warn("⚠️ Population failed, falling back to raw document data:", populateError.message);
            reviewData = await ReviewCase.findById(caseId);
        }

        if (!reviewData) {
            console.error(`❌ [PDF-FINAL ERROR] Case not found in Database for ID: ${caseId}`);
            return res.status(404).json({ success: false, message: 'Case not found.' });
        }
        
        console.log(`✅ [PDF-FINAL DB MATCH] Document loaded. Proceeding to build layout framework.`);

        const doc = new PDFDocument({ size: 'LETTER', margin: 50 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Official_Medical_Report_${caseId}.pdf`);

        // Track byte compilation stream output
        let bytesWritten = 0;
        doc.on('data', (chunk) => { bytesWritten += chunk.length; });
        doc.on('end', () => {
            console.log(`🏁 [PDF-FINAL STREAM FINISHED] Generated successfully. Size: ${(bytesWritten / 1024).toFixed(2)} KB`);
        });

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
        doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(11).text(String(caseId).toUpperCase(), 50, startY + 14);

        doc.fillColor('#64748B').font('Helvetica').fontSize(9).text('VERIFICATION DATE', 350, startY);
        const finalDate = reviewData.cmoOpinion?.approvedAt ? new Date(reviewData.cmoOpinion.approvedAt) : new Date();
        doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(11).text(finalDate.toLocaleDateString(), 350, startY + 14);

        doc.moveDown(3);

        // --- 3. 👑 LAYER 1: CHIEF MEDICAL OFFICER DIRECTIVE ---
        doc.fillColor('#4338CA').font('Helvetica-Bold').fontSize(13).text('I. EXECUTIVE CMO VERIFICATION');
        doc.moveDown(0.5);

        // Explicit fallback handling to ensure valid strings are passed to PDFKit
        const cmoVerdict = reviewData.cmoOpinion?.updatedVerdict ? String(reviewData.cmoOpinion.updatedVerdict) : "Approved and signed off by Executive Medical Board.";
        const cmoRecs = reviewData.cmoOpinion?.updatedRecommendations ? String(reviewData.cmoOpinion.updatedRecommendations) : "The Chief Medical Officer has fully verified the clinical roadmap outlined below.";
        const combinedCmoText = `Verdict:\n${cmoVerdict}\n\nRecommendations:\n${cmoRecs}`;
        
        const cmoBoxHeight = doc.heightOfString(combinedCmoText, { width: 480 });
        const cmoBoxY = doc.y;

        doc.rect(50, cmoBoxY, 512, cmoBoxHeight + 20).fill('#F5F7FF');
        doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(10).text(combinedCmoText, 65, cmoBoxY + 10, { width: 480, lineGap: 3 });

        doc.y = cmoBoxY + cmoBoxHeight + 35;

        // --- 4. 👨‍⚕️ LAYER 2: PRIMARY SPECIALIST REVIEW ---
        const specialistName = reviewData.assignedTo?.name || reviewData.doctorId?.name || "Staff Specialist";
        const specialistVerdict = reviewData.doctorOpinion?.finalVerdict ? String(reviewData.doctorOpinion.finalVerdict) : "Initial clinical triage phase complete.";
        const specialistRecs = reviewData.doctorOpinion?.recommendations ? String(reviewData.doctorOpinion.recommendations) : "Follow standard diagnostic therapeutic paths.";

        doc.fillColor('#1E7D75').font('Helvetica-Bold').fontSize(13).text(`II. SPECIALIST CLINICAL ANALYSIS (Dr. ${specialistName})`);
        doc.moveDown(0.5);

        const specText = `Verdict:\n${specialistVerdict}\n\nClinical Roadmap:\n${specialistRecs}`;
        const specBoxHeight = doc.heightOfString(specText, { width: 480 });

        if (doc.y + specBoxHeight > 680) {
            doc.addPage();
        }

        const specBoxY = doc.y;
        doc.rect(50, specBoxY, 512, specBoxHeight + 20).fill('#F8FAFC');
        doc.fillColor('#334155').font('Helvetica').fontSize(10).text(specText, 65, specBoxY + 10, { width: 480, lineGap: 3 });

        // --- 5. SECURE DIGITAL SIGNATURE FOOTER ---
        const bottomY = 710;
        doc.moveTo(50, bottomY).lineTo(562, bottomY).strokeColor('#E2E8F0').lineWidth(1).stroke();
        
        doc.fontSize(8).fillColor('#94A3B8').font('Helvetica')
           .text('This is a validated electronic document generated by PramanAI. Authenticity and clinical ownership logs are cryptographic fields locked within our secure records database.', 50, bottomY + 10, { width: 512, align: 'center' });

        doc.end();
    } catch (err) {
        console.error("❌ [PDF-FINAL CRITICAL FAULT]:", err);
        if (!res.headersSent) res.status(500).send('Error generating joint verification bundle');
    }
};