const { GoogleGenAI } = require("@google/genai"); // 2026 SDK
const ReviewCase = require('../models/ReviewCase');
const caseController = require('../controllers/caseController'); 

// Initialize with the 2026 SDK Syntax
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const AI_CONFIG = {
  primaryModel: "gemini-2.5-flash",
  fallbackModel: "gemini-1.5-flash-latest", // "latest" ensures you don't hit 404s on deprecation
};

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
      markers: ["Extraction failed: format error"]
    };
  }
};

exports.analyzeReports = async (caseId) => {
  console.log(`🤖 AI Service: Starting analysis for Case ${caseId}`);

  try {
    const currentCase = await ReviewCase.findById(caseId).populate('recordIds');

    if (!currentCase || !currentCase.recordIds.length) {
      console.error("❌ No records found for this case.");
      return;
    }

    // 1. Prepare Multimodal content (Images/PDFs + Prompt)
    const fileParts = currentCase.recordIds.map(record => ({
      inlineData: {
        data: record.fileData.toString("base64"),
        mimeType: record.contentType
      }
    }));

    const textPart = {
      text: `SYSTEM: Medical Data Assistant. 
             TASK: Extract summary, risk level, and markers.
             RETURN ONLY RAW JSON.
             { "summary": "string", "riskLevel": "Low/Medium/High", "markers": ["string"] }`
    };

    // 2. Execute with Fallback Reliability Logic
    let result;
    let structuredData;

    try {
      console.log(`🧬 Attempting Primary Model: ${AI_CONFIG.primaryModel}`);
      result = await ai.models.generateContent({
        model: AI_CONFIG.primaryModel,
        contents: [...fileParts, textPart]
      });
      structuredData = parseAIResponse(result.text);
    } catch (primaryError) {
      console.warn(`⚠️ Primary AI Failure: ${primaryError.message}. Switching to Fallback...`);
      
      // FALLBACK EXECUTION
      result = await ai.models.generateContent({
        model: AI_CONFIG.fallbackModel,
        contents: [...fileParts, textPart]
      });
      structuredData = parseAIResponse(result.text);
    }

    // 3. Database Update (Atomic)
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

    console.log(`✅ AI Service: Case ${caseId} updated. Triggering Notification...`);

    // 4. Trigger Notification (Only after DB is updated)
    await caseController.notifyDoctorCaseReady(caseId);

  } catch (error) {
    console.error("❌ AI Service CRITICAL FAILURE:", error.message);
    
    // Ensure the case is never stuck in "Processing"
    await ReviewCase.findByIdAndUpdate(caseId, { 
        status: 'PENDING_DOCTOR',
        'aiAnalysis.summary': 'AI Analysis failed. Please review records manually.' 
    });
    await caseController.notifyDoctorCaseReady(caseId);
  }
};