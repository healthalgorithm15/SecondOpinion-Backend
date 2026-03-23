const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const { AzureOpenAI } = require("openai");
const ReviewCase = require('../models/ReviewCase');
const caseController = require('../controllers/caseController');

// --- 1. CONFIGURATION & CLIENTS ---
const USE_MOCK_AI = process.env.USE_MOCK_AI === 'true';

// Azure Document Intelligence Client (The "Scanner")
const docClient = new DocumentAnalysisClient(
    process.env.AZURE_DOCUMENT_ENDPOINT, 
    new AzureKeyCredential(process.env.AZURE_DOCUMENT_KEY)
);

// Azure OpenAI Client (The "Brain")
const azureChat = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_KEY,
    apiVersion: "2024-06-01",
    deployment: process.env.AZURE_DEPLOYMENT_NAME || "gpt-4o"
});

/**
 * Mock Response for local testing/UI development
 */
const getMockResponse = () => ({
    summary: "[MOCK] Automated analysis complete. Patient shows elevated LDL cholesterol levels. All other vitals are within normal range.",
    riskLevel: "Medium",
    markers: ["LDL: 210 mg/dL (High)", "Glucose: 95 mg/dL (Normal)", "BP: 120/80 (Normal)"]
});

exports.analyzeReports = async (caseId) => {
    console.log(`🚀 Starting Hybrid AI Analysis for Case: ${caseId}`);
    
    try {
        // Fetch case and files from DB
        const currentCase = await ReviewCase.findById(caseId).populate('recordIds');
        if (!currentCase || !currentCase.recordIds.length) {
            throw new Error("Case records not found or empty.");
        }

        let structuredData;

        // --- PHASE 1: MOCK MODE CHECK ---
        if (USE_MOCK_AI) {
            console.log("🧪 MOCK MODE: Generating static test data...");
            structuredData = getMockResponse();
        } 
        
        // --- PHASE 2: PRODUCTION HYBRID FLOW ---
        else {
            let fullExtractedText = "";

            // 2a. EXTRACT TEXT (Handles unlimited PDF pages and Images)
            for (const record of currentCase.recordIds) {
                console.log(`🔍 Processing ${record.contentType} via Document Intelligence...`);
                
                // "prebuilt-layout" preserves table structures and reading order
                const poller = await docClient.beginAnalyzeDocument("prebuilt-layout", record.fileData);
                const { content } = await poller.pollUntilDone();
                
                fullExtractedText += `\n\n--- Start of Document: ${record._id} ---\n${content}\n--- End of Document ---`;
            }

            // 2b. CLINICAL REASONING (GPT-4o)
            console.log(`🧠 Reasoning with GPT-4o for Case ${caseId}...`);
            const prompt = `
                You are a professional medical assistant. Analyze the following extracted medical data from patient reports.
                
                INSTRUCTIONS:
                1. Provide a concise 2-sentence clinical summary.
                2. Identify key biomarkers and values. 
                3. Mark any value outside standard ranges as "(High)", "(Low)", or "(Abnormal)".
                4. Determine the overall riskLevel based on clinical urgency.

                DATA TO ANALYZE:
                ${fullExtractedText}

                RESPONSE FORMAT:
                Return ONLY a JSON object:
                {
                    "summary": "string",
                    "riskLevel": "Low" | "Medium" | "High",
                    "markers": ["string", "string"]
                }
            `;

            const aiResponse = await azureChat.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" },
                timeout: 60000 // 60s timeout for large multi-page reports
            });

            structuredData = JSON.parse(aiResponse.choices[0].message.content);
        }

        // --- PHASE 3: DATABASE UPDATE ---
        await ReviewCase.findByIdAndUpdate(caseId, {
            aiAnalysis: {
                summary: structuredData.summary,
                riskLevel: structuredData.riskLevel,
                extractedMarkers: structuredData.markers,
                analyzedAt: new Date(),
                modelVersion: USE_MOCK_AI ? "mock-mode" : "hybrid-docintel-gpt4o"
            },
            status: 'PENDING_DOCTOR',
            // Auto-prioritize high-risk cases for the doctor
            priority: structuredData.riskLevel === 'High' ? 'High' : 'Normal'
        });

        console.log(`✅ Analysis Complete for Case ${caseId}`);

    } catch (error) {
        // --- FAIL-SAFE: The "No-Stop" Flow ---
        console.error(`❌ AI SERVICE ERROR [Case ${caseId}]:`, error.message);
        
        await ReviewCase.findByIdAndUpdate(caseId, {
            status: 'PENDING_DOCTOR',
            aiAnalysis: { 
                summary: "Automated analysis failed. A manual clinical review of the uploaded files is required.", 
                riskLevel: "Medium",
                extractedMarkers: [],
                analyzedAt: new Date(),
                modelVersion: "error-fallback"
            }
        });
    } finally {
        // Always notify the doctor so the patient doesn't wait
        try {
            await caseController.notifyDoctorCaseReady(caseId);
        } catch (notifyErr) {
            console.error("🔔 Notification Failed:", notifyErr.message);
        }
    }
};