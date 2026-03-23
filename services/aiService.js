const { AzureOpenAI } = require("openai");
const ReviewCase = require('../models/ReviewCase');
const caseController = require('../controllers/caseController');

// --- 1. CONFIGURATION ---
const USE_MOCK_AI = process.env.USE_MOCK_AI === 'true';

// Initialize Azure Client
let azureClient = null;
if (process.env.AZURE_OPENAI_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    azureClient = new AzureOpenAI({
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        apiKey: process.env.AZURE_OPENAI_KEY,
        apiVersion: "2024-06-01", 
        deployment: process.env.AZURE_DEPLOYMENT_NAME || "gpt-4o",
    });
}

/**
 * Mock Data for local testing
 */
const getMockResponse = () => ({
    summary: "[MOCK] Automated analysis successful. No acute cardiac abnormalities detected.",
    riskLevel: "Low",
    markers: ["Heart Rate: 72bpm", "Rhythm: Sinus"]
});

exports.analyzeReports = async (caseId) => {
    console.log(`🚀 Starting Analysis Flow for Case: ${caseId}`);
    
    try {
        const currentCase = await ReviewCase.findById(caseId).populate('recordIds');
        if (!currentCase || !currentCase.recordIds.length) {
            throw new Error("Case or patient records not found in database.");
        }

        let structuredData;

        // --- PHASE 1: MOCK MODE ---
        if (USE_MOCK_AI) {
            console.log("🧪 MOCK ENABLED: Skipping Azure call.");
            structuredData = getMockResponse();
        } 
        
        // --- PHASE 2: AZURE PRODUCTION ---
        else if (azureClient) {
            console.log(`🟦 AZURE AI: Processing images for Case ${caseId}...`);
            
            const fileMessages = currentCase.recordIds.map(record => ({
                type: "image_url",
                image_url: { 
                    url: `data:${record.contentType || 'image/jpeg'};base64,${record.fileData.toString("base64")}` 
                }
            }));

            const response = await azureClient.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: "You are a professional medical assistant. Analyze reports and return ONLY JSON: { \"summary\": \"string\", \"riskLevel\": \"Low/Medium/High\", \"markers\": [\"string\"] }" 
                    },
                    { 
                        role: "user", 
                        content: [
                            { type: "text", text: "Analyze these reports:" },
                            ...fileMessages
                        ] 
                    }
                ],
                response_format: { type: "json_object" },
                timeout: 30000 // 30-second timeout to prevent infinite hanging
            });

            structuredData = JSON.parse(response.choices[0].message.content);
        } else {
            throw new Error("Azure Client not initialized (check ENV variables).");
        }

        // --- SUCCESS PATH: Update with AI findings ---
        await ReviewCase.findByIdAndUpdate(caseId, {
            aiAnalysis: {
                summary: structuredData.summary,
                riskLevel: structuredData.riskLevel,
                extractedMarkers: structuredData.markers,
                analyzedAt: new Date(),
                modelVersion: "azure-gpt-4o"
            },
            status: 'PENDING_DOCTOR',
            priority: structuredData.riskLevel === 'High' ? 'High' : 'Normal'
        });

        console.log(`✅ AI Success: Case ${caseId} pushed to doctor.`);

    } catch (error) {
        // --- FAIL-SAFE PATH: Don't stop the flow! ---
        console.error(`⚠️ AI FAILURE for Case ${caseId}:`, error.message);
        
        await ReviewCase.findByIdAndUpdate(caseId, {
            status: 'PENDING_DOCTOR', // Still move it to the doctor's queue
            priority: 'Normal',       // Default to normal since we don't know the risk
            aiAnalysis: { 
                summary: "Manual clinical review required (AI processing unavailable).", 
                riskLevel: "Medium", // Neutral middle ground
                extractedMarkers: [],
                analyzedAt: new Date(),
                modelVersion: "error-fallback"
            }
        });

        console.log(`📢 Fallback: Case ${caseId} submitted to doctor WITHOUT AI summary.`);
    } finally {
        // --- FINAL STEP: Always notify the doctor, regardless of success or failure ---
        try {
            await caseController.notifyDoctorCaseReady(caseId);
        } catch (notifyErr) {
            console.error("❌ Notification System Error:", notifyErr.message);
        }
    }
};