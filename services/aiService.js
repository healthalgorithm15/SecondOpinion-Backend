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
  console.log(`🤖 AI Service: Starting analysis for Case ${caseId}`);

  try {
    const currentCase = await ReviewCase.findById(caseId).populate('recordIds');

    if (!currentCase || !currentCase.recordIds.length) {
      console.error("❌ No records found for this case.");
      return;
    }

    // 2. Prepare file parts (Matching your test's inlineData structure)
    const fileParts = currentCase.recordIds.map(record => ({
      inlineData: {
        data: record.fileData.toString("base64"),
        mimeType: record.contentType // e.g., "image/jpeg"
      }
    }));

    // 3. Use the exact prompt and model from your successful test
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        ...fileParts,
        {
          text: `
            SYSTEM: You are a Clinical Assistant. 
            TASK: Extract data from this medical report.
            
            STRICT RULES:
            - Provide a 2-sentence summary.
            - Determine RiskLevel: Low, Medium, or High.
            - List key markers found (e.g., Hemoglobin, Glucose).
            - Return ONLY raw JSON. No markdown, no backticks.

            JSON STRUCTURE:
            {
              "summary": "string",
              "riskLevel": "string",
              "markers": ["string"]
            }
          `
        }
      ]
    });

    // 4. Extract and Parse (Matching your test logic)
    const responseText = result.text || result.response?.text || (typeof result === 'string' ? result : "");
    
    if (!responseText) {
       throw new Error("AI returned an empty response.");
    }

    const structuredData = JSON.parse(cleanJSON(responseText));

    // 5. Update ReviewCase in Database
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

    console.log(`✅ AI Service: Case ${caseId} analyzed successfully.`);
    await caseController.notifyDoctorCaseReady(caseId);

  } catch (error) {
    console.error("❌ AI Service CRITICAL FAILURE:", error.message);
    
    // Graceful Failure
    await ReviewCase.findByIdAndUpdate(caseId, { 
        status: 'PENDING_DOCTOR',
        'aiAnalysis.summary': 'AI Analysis was unable to process these files. Please review manually.' 
    });
    
    await caseController.notifyDoctorCaseReady(caseId);
  }
};