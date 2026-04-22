const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const { AzureOpenAI } = require("openai");
const ReviewCase = require('../models/ReviewCase');
const caseController = require('../controllers/caseController');

// --- 1. CONFIGURATION & CLIENTS ---
const USE_MOCK_AI = process.env.USE_MOCK_AI === 'true';

const docClient = new DocumentAnalysisClient(
    process.env.AZURE_DOCUMENT_ENDPOINT, 
    new AzureKeyCredential(process.env.AZURE_DOCUMENT_KEY)
);

const azureChat = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_KEY,
    apiVersion: "2024-06-01",
    deployment: process.env.AZURE_DEPLOYMENT_NAME || "gpt-4o"
});

const getMockResponse = () => ({
    summary: "[MOCK] Automated analysis complete. Patient shows elevated LDL cholesterol levels. All other vitals are within normal range.",
    riskLevel: "Medium",
    markers: ["LDL: 210 mg/dL (High)", "Glucose: 95 mg/dL (Normal)", "BP: 120/80 (Normal)"]
});

exports.analyzeReports = async (caseId) => {
    console.log(`🚀 Starting Hybrid AI Analysis for Case: ${caseId}`);
    
    try {
        // 🟢 UPDATE: Ensure we have the latest case data including the patientNote
        const currentCase = await ReviewCase.findById(caseId).populate('recordIds');
        if (!currentCase || !currentCase.recordIds || currentCase.recordIds.length === 0) {
            throw new Error("Case records not found or empty.");
        }

        let structuredData;

        if (USE_MOCK_AI) {
            console.log("🧪 MOCK MODE: Generating static test data...");
            await new Promise(resolve => setTimeout(resolve, 2000));
            structuredData = getMockResponse();
        } 
        else {
            // 2a. PARALLEL TEXT EXTRACTION
            console.log(`🔍 Processing ${currentCase.recordIds.length} documents in parallel...`);
            
            const extractionPromises = currentCase.recordIds.map(async (record) => {
                if (!record.fileData) return `[Empty Document: ${record.title}]`;
                
                try {
                    const poller = await docClient.beginAnalyzeDocument("prebuilt-layout", record.fileData);
                    const { content } = await poller.pollUntilDone();
                    return `--- Start of Document: ${record.title} (${record._id}) ---\n${content}\n--- End of Document ---`;
                } catch (err) {
                    console.error(`Error extracting ${record._id}:`, err.message);
                    return `[Error extracting text from ${record.title}]`;
                }
            });

            const results = await Promise.all(extractionPromises);
            let fullExtractedText = results.join('\n\n');

            const MAX_TEXT_LENGTH = 120000; 
            if (fullExtractedText.length > MAX_TEXT_LENGTH) {
                fullExtractedText = fullExtractedText.substring(0, MAX_TEXT_LENGTH) + "... [Text Truncated]";
            }

            // 2b. CLINICAL REASONING
            // 🟢 UPDATE: Injecting the patient's note into the AI context
            const prompt = `
                You are a professional medical assistant. Analyze the following medical reports.
                
                PATIENT'S PERSONAL MESSAGE/CONTEXT:
                "${currentCase.patientNote || 'No specific symptoms or notes provided.'}"

                EXTRACTED DATA:
                ${fullExtractedText}

                INSTRUCTIONS:
                1. Provide a concise 2-sentence clinical summary. 
                   *Crucial*: Contextualize the lab findings based on the patient's personal message.
                2. Identify key biomarkers and values. 
                3. Mark any value outside standard ranges as "(High)", "(Low)", or "(Abnormal)".
                4. Determine the overall riskLevel based on clinical urgency.

                RESPONSE FORMAT (JSON ONLY):
                {
                    "summary": "string",
                    "riskLevel": "Low" | "Medium" | "High",
                    "markers": ["string"]
                }
            `;

            const aiResponse = await azureChat.chat.completions.create(
                {
                    messages: [{ role: "user", content: prompt }],
                    response_format: { type: "json_object" },
                    temperature: 0.3 
                },
                { timeout: 60000 }
            );

            const rawContent = aiResponse.choices[0].message.content;
            const cleanJson = rawContent.replace(/```json|```/g, "").trim();
            structuredData = JSON.parse(cleanJson);
        }

        // --- 3. DATABASE UPDATE ---
        await ReviewCase.findByIdAndUpdate(caseId, {
            aiAnalysis: {
                summary: structuredData.summary,
                riskLevel: structuredData.riskLevel,
                extractedMarkers: structuredData.markers,
                analyzedAt: new Date(),
                modelVersion: USE_MOCK_AI ? "mock-mode" : "hybrid-docintel-gpt4o"
            },
            status: 'UNASSIGNED', 
            priority: structuredData.riskLevel === 'High' ? 'High' : 'Normal'
        });

        console.log(`✅ Analysis Complete for Case ${caseId}`);

    } catch (error) {
        console.error(`❌ AI SERVICE ERROR [Case ${caseId}]:`, error.message);
        
        await ReviewCase.findByIdAndUpdate(caseId, {
            status: 'UNASSIGNED',
            aiAnalysis: { 
                summary: "Automated analysis failed. Manual clinical review required.", 
                riskLevel: "Medium",
                extractedMarkers: [],
                analyzedAt: new Date(),
                modelVersion: "error-fallback"
            }
        });
    } finally {
        try {
            // This triggers notifications for the CMO to review the new case
            await caseController.notifyDoctorCaseReady(caseId);
        } catch (notifyErr) {
            console.error("🔔 Notification Failed:", notifyErr.message);
        }
    }
};