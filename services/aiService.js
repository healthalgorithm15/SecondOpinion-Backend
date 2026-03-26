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
        const currentCase = await ReviewCase.findById(caseId).populate('recordIds');
        if (!currentCase || !currentCase.recordIds.length) {
            throw new Error("Case records not found or empty.");
        }

        let structuredData;

        if (USE_MOCK_AI) {
            console.log("🧪 MOCK MODE: Generating static test data...");
            structuredData = getMockResponse();
        } 
        else {
            let fullExtractedText = "";

            // 2a. EXTRACT TEXT
            for (const record of currentCase.recordIds) {
                console.log(`🔍 Processing ${record.contentType} via Document Intelligence...`);
                const poller = await docClient.beginAnalyzeDocument("prebuilt-layout", record.fileData);
                const { content } = await poller.pollUntilDone();
                fullExtractedText += `\n\n--- Start of Document: ${record._id} ---\n${content}\n--- End of Document ---`;
            }

            // Safety: Truncate if text is too long for the LLM context
            const MAX_TEXT_LENGTH = 120000; 
            if (fullExtractedText.length > MAX_TEXT_LENGTH) {
                fullExtractedText = fullExtractedText.substring(0, MAX_TEXT_LENGTH) + "... [Text Truncated]";
            }

            // 2b. CLINICAL REASONING
            const prompt = `
                You are a professional medical assistant. Analyze the following extracted medical data.
                1. Provide a concise 2-sentence clinical summary.
                2. Identify key biomarkers and values. 
                3. Mark any value outside standard ranges as "(High)", "(Low)", or "(Abnormal)".
                4. Determine the overall riskLevel based on clinical urgency.

                DATA: ${fullExtractedText}

                RESPONSE FORMAT (JSON ONLY):
                {
                    "summary": "string",
                    "riskLevel": "Low" | "Medium" | "High",
                    "markers": ["string"]
                }
            `;

            // ✅ FIXED: Timeout moved to the 2nd argument (Options object)
            const aiResponse = await azureChat.chat.completions.create(
                {
                    messages: [{ role: "user", content: prompt }],
                    response_format: { type: "json_object" },
                },
                {
                    timeout: 60000 // 60s network timeout
                }
            );

            structuredData = JSON.parse(aiResponse.choices[0].message.content);
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
            status: 'PENDING_DOCTOR',
            priority: structuredData.riskLevel === 'High' ? 'High' : 'Normal'
        });

        console.log(`✅ Analysis Complete for Case ${caseId}`);

    } catch (error) {
        console.error(`❌ AI SERVICE ERROR [Case ${caseId}]:`, error.message);
        
        await ReviewCase.findByIdAndUpdate(caseId, {
            status: 'PENDING_DOCTOR',
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
            await caseController.notifyDoctorCaseReady(caseId);
        } catch (notifyErr) {
            console.error("🔔 Notification Failed:", notifyErr.message);
        }
    }
};