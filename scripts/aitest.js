require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

/**
 * Helper to clean Markdown formatting if the AI ignores "STRICT RULES"
 */
const cleanJSON = (text) => {
  return text.replace(/```json|```/g, "").trim();
};

async function runProductionTest() {
  console.log("🚀 Initializing Medical AI Test...");

  // 1. Initialize Client
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  // 2. Initialize the specific model instance
  // Note: Using 'gemini-1.5-flash' as '2.5' is not a standard public endpoint yet
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  try {
    const filePath = path.join(__dirname, 'ecg.jpg'); 
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found at ${filePath}. Please add an image to test.`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');

    console.log("🧬 Document loaded. Sending to Gemini...");

    // 3. Execution using the model instance
    const result = await model.generateContent([
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
    ]);

    // 4. Extract and Parse
    const response = await result.response;
    let responseText = response.text();
    
    // Safety clean in case AI includes markdown backticks
    responseText = cleanJSON(responseText);

    const aiData = JSON.parse(responseText);
    console.log("✅ AI Analysis Received:", aiData);

    // 5. PDF Generation
    const doc = new PDFDocument();
    const outputName = `Analysis_${Date.now()}.pdf`;
    const outputPath = path.join(__dirname, outputName);
    
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    doc.fontSize(20).text('MEDICAL REPORT SUMMARY', { align: 'center' });
    doc.moveDown();
    
    const riskColor = aiData.riskLevel === 'High' ? '#FF0000' : '#000000';
    doc.fontSize(14).fillColor(riskColor).text(`Risk Level: ${aiData.riskLevel}`);
    
    doc.moveDown().fillColor('#000000').fontSize(12).text(`Summary: ${aiData.summary}`);
    doc.moveDown().text('Key Markers:');
    
    aiData.markers.forEach(m => doc.text(`- ${m}`));
    
    doc.end();

    stream.on('finish', () => {
      console.log(`\n📄 Success! PDF created: ${outputName}`);
    });

  } catch (error) {
    console.error("\n❌ TEST FAILED:");
    if (error instanceof SyntaxError) {
      console.error("Data was not valid JSON. Response received was not parseable.");
    } else {
      console.error(error.message);
    }
  }
}

runProductionTest();