const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
const ReviewCase = require('../models/ReviewCase');
const caseController = require('../controllers/caseController');

// Correct Initialization for the official SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * 🤖 Main Service: Analyzes medical reports with strict JSON output
 */
exports.analyzeReports = async (caseId, attempt = 0) => {
    const MODELS = ["gemini-1.5-flash", "gemini-1.5-pro"];
    const currentModelName = MODELS[attempt] || MODELS[0];

    console.log(`🤖 AI Attempt ${attempt + 1}: Using ${currentModelName} for Case ${caseId}`);

    try {
        const currentCase = await ReviewCase.findById(caseId).populate('recordIds');
        if (!currentCase || !currentCase.recordIds.length) {
            console.error("❌ Case or records missing.");
            return;
        }

        // Initialize model with Response Schema for 100% JSON reliability
        const model = genAI.getGenerativeModel({ 
            model: currentModelName,
            generationConfig: {
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
            }
        });

        // Prepare multimodal data
        const fileParts = currentCase.recordIds.map(record => ({
            inlineData: {
                data: record.fileData.toString("base64"),
                mimeType: record.contentType || "application/pdf"
            }
        }));

        const prompt = `
            SYSTEM: Professional Medical Assistant.
            TASK: Analyze the attached reports. 
            Provide a 2-sentence clinical summary.
            Identify key medical markers (e.g., HbA1c, BP, Sugar levels).
            Assign a Risk Level based on urgency.
        `;

        // Generate content with timeout
        const result = await Promise.race([
            model.generateContent([prompt, ...fileParts]),
            new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 45000))
        ]);

        const response = await result.response;
        const responseText = response.text();
        
        // No regex needed! The model is forced to return raw JSON string.
        const structuredData = JSON.parse(responseText);

        // Update Database
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

        // Auto-Fallback Logic
        if (attempt < MODELS.length - 1) {
            console.log(`🔄 Attempting fallback to ${MODELS[attempt + 1]}...`);
            return exports.analyzeReports(caseId, attempt + 1);
        }

        // Final Graceful Degradation
        console.error("🔥 All AI models failed. Proceeding to Manual Review.");
        await ReviewCase.findByIdAndUpdate(caseId, {
            status: 'PENDING_DOCTOR',
            aiAnalysis: {
                summary: 'AI Analysis currently unavailable. Manual review required.',
                riskLevel: 'Medium',
                analyzedAt: new Date()
            }
        });

        await caseController.notifyDoctorCaseReady(caseId);
    }
};