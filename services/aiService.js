const { GoogleGenAI } = require("@google/genai");
const ReviewCase = require('../models/ReviewCase');
const MedicalRecord = require('../models/MedicalRecord');
const { sendPushToRole } = require('../utils/notificationHelper'); // Utility to handle Expo API

// Initialize the AI Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Utility to extract JSON from AI text response
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
    // We populate 'patientId' to get the name for notifications
    const currentCase = await ReviewCase.findById(caseId)
      .populate('recordIds')
      .populate('patientId', 'name');

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

    // 4. Generate Content (Gemini 2.5 Flash)
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
    const updatedCase = await ReviewCase.findByIdAndUpdate(caseId, {
      aiAnalysis: {
        summary: structuredData.summary,
        riskLevel: structuredData.riskLevel,
        extractedMarkers: structuredData.markers,
        analyzedAt: new Date()
      },
      status: 'PENDING_DOCTOR', 
      priority: structuredData.riskLevel === 'High' ? 'High' : 'Normal'
    }, { new: true });

    console.log(`✅ AI Service: Case ${caseId} is now PENDING_DOCTOR`);

    // 🟢 7. REAL-TIME NOTIFICATION (Socket.io)
    // Notify all online doctors immediately
    if (global.io) {
      global.io.to('doctor').emit('newCase', {
        caseId: updatedCase._id,
        patientName: currentCase.patientId?.name || "New Patient",
        riskLevel: structuredData.riskLevel,
        summary: structuredData.summary
      });
      console.log(`⚡ Socket: Broadcasted newCase event to room 'doctor'`);
    }

    // 🟢 8. PUSH NOTIFICATION (Expo)
    // Notify doctors even if the app is closed
    await sendPushToRole(
      'doctor', 
      "🚨 New Case Assigned", 
      `${currentCase.patientId?.name || 'A patient'} uploaded a ${structuredData.riskLevel} risk case.`,
      { caseId: updatedCase._id }
    );

  } catch (error) {
    console.error("❌ AI Service CRITICAL FAILURE:", error.message);
    
    // Fallback: Ensure the case isn't stuck.
    await ReviewCase.findByIdAndUpdate(caseId, { 
      status: 'PENDING_DOCTOR',
      'aiAnalysis.summary': "AI Analysis failed to process. Manual review required."
    });

    // Notify doctors even if AI failed so they know a case is waiting
    if (global.io) global.io.to('doctor').emit('newCase', { caseId });
  }
};