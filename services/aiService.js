const { GoogleGenAI } = require("@google/genai"); 
const ReviewCase = require('../models/ReviewCase');
const caseController = require('../controllers/caseController'); 

// Initialize the Gemini API
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);

const AI_CONFIG = {
  primaryModel: "gemini-2.0-flash", // Recommended for speed and extraction
  fallbackModel: "gemini-1.5-flash",
};

/**
 * 🛠️ Helper: Extracts JSON from Gemini's markdown-style response
 */
const parseAIResponse = (text) => {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}') + 1;
    if (start === -1 || end === 0) throw new Error("No JSON found");
    const cleaned = text.substring(start, end);
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("⚠️ AI Parsing Error. Raw Text:", text);
    return {
      summary: "AI analysis completed. Please review documents for details.",
      riskLevel: "Medium",
      markers: ["Data extraction incomplete"]
    };
  }
};

/**
 * 🤖 Main Service: Analyzes medical reports using Multimodal Gemini
 */
exports.analyzeReports = async (caseId) => {
  console.log(`🤖 AI Service: Starting analysis for Case ${caseId}`);

  try {
    // 1. Fetch case and populate the actual record data
    const currentCase = await ReviewCase.findById(caseId).populate('recordIds');

    if (!currentCase || !currentCase.recordIds.length) {
      console.error("❌ No records found for this case.");
      return;
    }

    // 2. Prepare file parts for Gemini (Base64 conversion)
    const fileParts = currentCase.recordIds.map(record => ({
      inlineData: {
        data: record.fileData.toString("base64"),
        mimeType: record.contentType
      }
    }));

    const prompt = {
      text: `SYSTEM: You are a professional Medical Data Assistant. 
             TASK: Analyze the attached medical documents. Extract a high-level summary, determine the risk level, and list key medical markers found.
             CONSTRAINT: Return ONLY a raw JSON object. Do not include markdown code blocks or conversational text.
             FORMAT: { "summary": "string", "riskLevel": "Low/Medium/High", "markers": ["string"] }`
    };

    let result;
    let structuredData;

    try {
      // 🟢 PRIMARY MODEL ATTEMPT
      console.log(`📡 Sending to Primary Model: ${AI_CONFIG.primaryModel}`);
      const model = ai.getGenerativeModel({ model: AI_CONFIG.primaryModel });
      result = await model.generateContent([...fileParts, prompt]);
      structuredData = parseAIResponse(result.response.text());
    } catch (primaryError) {
      console.warn(`⚠️ Primary AI Failure: ${primaryError.message}. Switching to Fallback...`);
      
      // 🟡 FALLBACK MODEL ATTEMPT
      const fallbackModel = ai.getGenerativeModel({ model: AI_CONFIG.fallbackModel });
      result = await fallbackModel.generateContent([...fileParts, prompt]);
      structuredData = parseAIResponse(result.response.text());
    }

    // 3. Update ReviewCase in Database
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

    // 4. Trigger Real-time Notifications (Socket/Push)
    await caseController.notifyDoctorCaseReady(caseId);

  } catch (error) {
    console.error("❌ AI Service CRITICAL FAILURE:", error.message);
    
    // Graceful Failure: Move case to doctor even if AI fails
    await ReviewCase.findByIdAndUpdate(caseId, { 
        status: 'PENDING_DOCTOR',
        'aiAnalysis.summary': 'AI Analysis was unable to process these files. Please review manually.' 
    });
    
    await caseController.notifyDoctorCaseReady(caseId);
  }
};