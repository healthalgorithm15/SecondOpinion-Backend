const { GoogleGenerativeAI } = require("@google/generative-ai");
const ReviewCase = require('../models/ReviewCase');
const MedicalRecord = require('../models/MedicalRecord');
// Import the caseController to use its notification helpers
const caseController = require('../controllers/caseController'); 

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const parseAIResponse = (text) => {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}') + 1;
    if (start === -1 || end === 0) throw new Error("No JSON found");
    return JSON.parse(text.substring(start, end));
  } catch (err) {
    console.error("⚠️ AI Parsing Error:", err.message);
    return {
      summary: "AI analysis completed. Manual review of documents is required.",
      riskLevel: "Medium",
      markers: ["Extraction failed"]
    };
  }
};

exports.analyzeReports = async (caseId) => {
  console.log(`🤖 AI Service: Starting analysis for Case ${caseId}`);

  try {
    const currentCase = await ReviewCase.findById(caseId)
      .populate('recordIds')
      .populate('patientId', 'name');

    if (!currentCase || !currentCase.recordIds.length) {
      console.error("❌ No records found for this case.");
      return;
    }

    // 1. Prepare files for Gemini
    const fileParts = currentCase.recordIds.map(record => ({
      inlineData: {
        data: record.fileData.toString("base64"),
        mimeType: record.contentType
      }
    }));

    const prompt = `
      SYSTEM: Medical Data Assistant. Return ONLY JSON.
      { "summary": "2 sentences", "riskLevel": "Low/Medium/High", "markers": ["key: value"] }
    `;

    // 2. AI Generation
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent([...fileParts, prompt]);
    const response = await result.response;
    const structuredData = parseAIResponse(response.text());

    // 3. Update Database
    await ReviewCase.findByIdAndUpdate(caseId, {
      aiAnalysis: {
        summary: structuredData.summary,
        riskLevel: structuredData.riskLevel,
        extractedMarkers: structuredData.markers,
        analyzedAt: new Date()
      },
      status: 'PENDING_DOCTOR', 
      priority: structuredData.riskLevel === 'High' ? 'High' : 'Normal'
    });

    console.log(`✅ AI Service: Case ${caseId} updated to PENDING_DOCTOR`);

    // 4. TRIGGER NOTIFICATIONS via CaseController
    // This handles both Socket.io and High-Priority Push Notifications
    await caseController.notifyDoctorCaseReady(caseId);

  } catch (error) {
    console.error("❌ AI Service CRITICAL FAILURE:", error.message);
    
    // Fallback so the case isn't stuck
    await ReviewCase.findByIdAndUpdate(caseId, { status: 'PENDING_DOCTOR' });
    await caseController.notifyDoctorCaseReady(caseId);
  }
};