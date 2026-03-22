const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
const ReviewCase = require('../models/ReviewCase');
const caseController = require('../controllers/caseController');

// Initialize with modern SDK structure
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * 🤖 Main Service: Analyzes medical reports with strict JSON output
 */
exports.analyzeReports = async (caseId, attempt = 0) => {
    // Standardizing on stable production model names
    const MODELS = ["gemini-1.5-flash", "gemini-1.5-pro"];
    const currentModelName = MODELS[attempt] || MODELS[0];

    console.log(`🤖 AI Attempt ${attempt + 1}: Using ${currentModelName} for Case ${caseId}`);

    try {
        const currentCase = await ReviewCase.findById(caseId).populate('recordIds');
        
        if (!currentCase || !currentCase.recordIds || currentCase.recordIds.length === 0) {
            console.error("❌ Case or records missing/empty.");
            return;
        }

        // Initialize model with Strict Schema Enforcement
        const model = genAI.getGenerativeModel({ 
            model: currentModelName 
        });

        const generationConfig = {
            responseMimeType: "application/json",
            responseSchema: {
                type: SchemaType.OBJECT,
                properties: {
                    summary: { type: SchemaType.STRING },
                    riskLevel: { 
                        type: SchemaType.STRING, 
                        enum: ["Low", "Medium", "High"] 
                    },
                    markers: {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING }
                    }
                },
                required: ["summary", "riskLevel", "markers"]
            }
        };

        // Map files to the correct Multimodal format
        const fileParts = currentCase.recordIds.map(record => {
            if (!record.fileData) return null;
            return {
                inlineData: {
                    data: record.fileData.toString("base64"),
                    mimeType: record.contentType || "image/jpeg"
                }
            };
        }).filter(part => part !== null);

        const prompt = `
            SYSTEM: Professional Clinical Assistant.
            TASK: Analyze the attached medical reports/images. 
            - Provide a concise 2-sentence clinical summary.
            - Identify key medical markers (e.g., HbA1c, BP, Sugar levels).
            - Assign a Risk Level based on clinical urgency.
        `;

        // Execution with built-in timeout safeguard
        const result = await Promise.race([
            model.generateContent({
                contents: [{ role: "user", parts: [ { text: prompt }, ...fileParts ] }],
                generationConfig
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("AI_TIMEOUT")), 50000))
        ]);

        const response = await result.response;
        const responseText = response.text();
        
        // Parse results (ResponseSchema ensures this is valid JSON)
        const structuredData = JSON.parse(responseText);

        // Update Case with Analysis
        const normalizedRisk = structuredData.riskLevel || 'Low';
        const isHighPriority = normalizedRisk === 'High';

        await ReviewCase.findByIdAndUpdate(caseId, {
            aiAnalysis: {
                summary: structuredData.summary,
                riskLevel: normalizedRisk,
                extractedMarkers: structuredData.markers || [],
                analyzedAt: new Date(),
                modelVersion: currentModelName
            },
            status: 'PENDING_DOCTOR',
            priority: isHighPriority ? 'High' : 'Normal'
        });

        console.log(`✅ AI Analysis Successful: Case ${caseId}`);
        await caseController.notifyDoctorCaseReady(caseId);

    } catch (error) {
        console.error(`❌ AI Error on ${currentModelName}:`, error.message);

        // Fallback Logic: Try next model if available
        if (attempt < MODELS.length - 1) {
            console.log(`🔄 Fallback triggered: Switching to ${MODELS[attempt + 1]}...`);
            return exports.analyzeReports(caseId, attempt + 1);
        }

        // Final Graceful Degradation: Move to manual review
        console.error("🔥 All AI attempts exhausted. Moving to manual specialist review.");
        await ReviewCase.findByIdAndUpdate(caseId, {
            status: 'PENDING_DOCTOR',
            aiAnalysis: {
                summary: 'AI analysis encountered a technical error. Specialist manual review is required.',
                riskLevel: 'Medium',
                analyzedAt: new Date(),
                error: error.message
            }
        });

        await caseController.notifyDoctorCaseReady(caseId);
    }
};