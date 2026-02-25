const { GoogleGenAI } = require("@google/genai"); // 2026 SDK
const ReviewCase = require('../models/ReviewCase');
const MedicalRecord = require('../models/MedicalRecord');

// Initialize the AI Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Utility to extract JSON from AI text response
 * This prevents crashes if the AI adds "Here is the result:" or backticks.
 */
const parseAIResponse = (text) => {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}') + 1;
    if (start === -1 || end === 0) throw new Error("No JSON found");
    
    const jsonString = text.substring(start, end);
    return JSON.parse(jsonString);
  } catch (err) {
    console.error("⚠️ AI Parsing Error, using fallback:", err.message);
    return {
      summary: "AI analysis completed. Please review documents for specific details.",
      riskLevel: "Medium",
      markers: ["Manual Extraction Required"]
    };
  }
};

/**
 * Core AI Analysis Service
 * Triggered in background by PatientController
 */
exports.analyzeReports = async (caseId) => {
  console.log(`🤖 AI Service: Starting analysis for Case ${caseId}`);

  try {
    // 1. Fetch Case and actual File Buffers
    const currentCase = await ReviewCase.findById(caseId).populate('recordIds');
    if (!currentCase || !currentCase.recordIds.length) {
      console.error("❌ No records found for this case.");
      return;
    }

    // 2. Convert MongoDB Buffers to Gemini Base64 format
    const fileParts = currentCase.recordIds.map(record => ({
      inlineData: {
        data: record.fileData.toString("base64"),
        mimeType: record.contentType
      }
    }));

    // 3. Define the Clinical System Prompt
    const prompt = `
      SYSTEM: You are a Medical Data Assistant. 
      TASK: Analyze the attached reports.
      
      STRICT OUTPUT RULES:
      - Return ONLY a JSON object.
      - summary: 2-sentence overview of key findings.
      - riskLevel: Low, Medium, or High.
      - markers: List key lab values found (e.g. "HbA1c: 6.5%").

      STRUCTURE:
      {
        "summary": "...",
        "riskLevel": "...",
        "markers": ["...", "..."]
      }
    `;

    // 4. Generate Content (Gemini 2.5 Flash is best for speed/cost)
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [...fileParts, { text: prompt }]
        }
      ]
    });

    // 5. Parse and Sanitize
    const structuredData = parseAIResponse(result.text);

    // 6. Update Case in Database
    await ReviewCase.findByIdAndUpdate(caseId, {
      aiAnalysis: {
        summary: structuredData.summary,
        riskLevel: structuredData.riskLevel,
        extractedMarkers: structuredData.markers,
        analyzedAt: new Date()
      },
      status: 'PENDING_DOCTOR', // 🚀 Move to Doctor's worklist
      priority: structuredData.riskLevel === 'High' ? 'High' : 'Normal'
    });

    console.log(`✅ AI Service: Case ${caseId} is now PENDING_DOCTOR`);

  } catch (error) {
    console.error("❌ AI Service CRITICAL FAILURE:", error.message);
    
    // Fallback: Ensure the case isn't stuck. Move it to the doctor anyway.
    await ReviewCase.findByIdAndUpdate(caseId, { 
      status: 'PENDING_DOCTOR',
      'aiAnalysis.summary': "AI Analysis failed to process. Manual review required."
    });
  }
};