const { GoogleGenAI } = require("@google/genai"); 
const ReviewCase = require('../models/ReviewCase');
const caseController = require('../controllers/caseController'); 

// 1. Initialize using the same pattern as your successful test
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * 🛠️ Helper: Matches your test script's cleaning logic
 */
const cleanJSON = (text) => {
  return text.replace(/```json|```/g, "").trim();
};

/**
 * 🤖 Main Service: Analyzes medical reports using the working Test Logic
 */
exports.analyzeReports = async (caseId) => {
  try {
    const currentCase = await ReviewCase.findById(caseId).populate('recordIds');
    if (!currentCase || !currentCase.recordIds.length) return;

    // Map records to the expected format
    const fileParts = currentCase.recordIds.map(record => ({
      inlineData: {
        data: record.fileData.toString("base64"),
        mimeType: record.contentType 
      }
    }));

    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      SYSTEM: Clinical Assistant. TASK: Extract data.
      RULES: 2-sentence summary. RiskLevel: Low, Medium, High. List markers. 
      Return ONLY raw JSON.
      JSON: {"summary": "string", "riskLevel": "Low|Medium|High", "markers": []}
    `;

    // Correct SDK call pattern
    const result = await model.generateContent([prompt, ...fileParts]);
    const response = await result.response;
    const responseText = response.text();

    const structuredData = JSON.parse(cleanJSON(responseText));

    // Normalize risk for priority logic
    const normalizedRisk = (structuredData.riskLevel || 'Low').trim();
    const isHighPriority = normalizedRisk.toLowerCase() === 'high';

    await ReviewCase.findByIdAndUpdate(caseId, {
      aiAnalysis: {
        summary: structuredData.summary,
        riskLevel: normalizedRisk,
        extractedMarkers: structuredData.markers || [],
        analyzedAt: new Date()
      },
      status: 'PENDING_DOCTOR', 
      priority: isHighPriority ? 'High' : 'Normal'
    });

    console.log(`✅ AI Analysis Complete for ${caseId}`);
    await caseController.notifyDoctorCaseReady(caseId);

  } catch (error) {
    console.error("❌ AI Failure:", error.message);
    // Fallback to manual doctor review
    await ReviewCase.findByIdAndUpdate(caseId, { 
        status: 'PENDING_DOCTOR',
        'aiAnalysis.summary': 'AI was unable to process files. Manual review required.' 
    });
    await caseController.notifyDoctorCaseReady(caseId);
  }
};