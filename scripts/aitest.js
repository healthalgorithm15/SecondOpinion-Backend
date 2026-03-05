require('dotenv').config();
const { GoogleGenAI } = require("@google/genai"); // 2026 SDK
const fs = require('fs');
const path = require('path');

const PDFDocument = require('pdfkit');
/**
 * Helper to clean Markdown formatting from AI responses
 */
const cleanJSON = (text) => {
  return text.replace(/```json|```/g, "").trim();
};

async function runProductionTest() {
  console.log("🚀 Initializing Medical AI Test...");

  // 1. Initialize Client
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  try {
    // 2. Load Sample File (Simulating MongoDB Buffer)
    // Make sure 'sample-report.jpg' exists in your /scripts folder!
    const filePath = path.join(__dirname, 'ecg.jpg'); 
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found at ${filePath}. Please add an image to test.`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');

    console.log("🧬 Document loaded. Sending to Gemini 2.5-Flash...");

    // 3. The Production Prompt & Execution
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: "image/jpeg", 
            data: base64Data
          }
        },
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

    // 4. Clean and Parse the result
    const responseText = result.text || result.response?.text || (typeof result === 'string' ? result : "");
    
    if (!responseText) {
       console.log("Full Result Debug:", JSON.stringify(result, null, 2));
       throw new Error("AI returned an empty response or structure is different.");
    }
    const aiData = JSON.parse(responseText);

    // 3. PDF Generation
    const doc = new PDFDocument();
    const outputName = `Analysis_${Date.now()}.pdf`;
    doc.pipe(fs.createWriteStream(path.join(__dirname, outputName)));

    // PDF Content
    doc.fontSize(20).text('MEDICAL REPORT SUMMARY', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Risk Level: ${aiData.riskLevel}`, { 
      color: aiData.riskLevel === 'High' ? 'red' : 'black' 
    });
    doc.moveDown().text(`Summary: ${aiData.summary}`);
    doc.moveDown().text('Key Markers:');
    aiData.markers.forEach(m => doc.text(`- ${m}`));
    
    doc.end();
    console.log(`✅ Success! PDF created: ${outputName}`);

  } catch (error) {
    console.error("❌ TEST FAILED:");
    if (error instanceof SyntaxError) {
      console.error("Data was not valid JSON. Raw response was:", error.message);
    } else {
      console.error(error.message);
    }
  }
}

runProductionTest();