const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
const ReviewCase = require('../models/ReviewCase');
const caseController = require('../controllers/caseController');

// Initialize Gemini with the API Key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * 🤖 Production-Ready AI Analysis Service
 */
exports.analyzeReports = async (caseId, attempt = 0) => {
    // Models to try - in prod, start with Flash for speed, fallback to Pro for complex cases
    const MODELS = ["gemini-1.5-flash", "gemini-1.5-pro"];
    const currentModelName = MODELS[attempt] || MODELS[0];

    console.log(`🤖 AI Attempt ${attempt + 1}: Using ${currentModelName} for Case ${caseId}`);

    try {
        const currentCase = await ReviewCase.findById(caseId).populate('recordIds');
        
        if (!currentCase || !currentCase.recordIds || currentCase.recordIds.length === 0) {
            throw new Error("CASE_NOT_FOUND_OR_EMPTY");
        }

        // 1. Define strict JSON schema (Native to Gemini SDK)
        // This forces the AI to return JSON without any markdown or extra text
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

        // 2. Map file data safely
        const fileParts = currentCase.recordIds.map(record => {
            if (!record.fileData) return null;
            return {
                inlineData: {
                    data: record.fileData.toString("base64"),
                    mimeType: record.contentType || "application/pdf"
                }
            };
        }).filter(Boolean);

        const prompt = `You are a Clinical Assistant. Analyze the attached medical reports. 
        Provide a concise 2-sentence summary and list key medical markers found.
        Categorize the Risk Level based on clinical urgency.`;

        // 3. Generate Content (SDK handles the parts)
        const result = await model.generateContent([prompt, ...fileParts]);
        const response = await result.response;
        const text = response.text();

        // No Regex needed anymore because we used generationConfig
        const structuredData = JSON.parse(text);

        // 4. Update Database
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
        console.error(`❌ AI Error [${currentModelName}]:`, error.message);

        // Fallback Logic
        if (attempt < MODELS.length - 1) {
            console.log(`🔄 Retrying with next model: ${MODELS[attempt + 1]}`);
            return exports.analyzeReports(caseId, attempt + 1);
        }

        // Final Graceful Degradation: Move to doctor even if AI fails
        console.error("🔥 All AI attempts exhausted. Marking for Manual Review.");
        await ReviewCase.findByIdAndUpdate(caseId, {
            status: 'PENDING_DOCTOR',
            aiAnalysis: {
                summary: 'AI analysis service failed. Please review documents manually.',
                riskLevel: 'Medium',
                analyzedAt: new Date(),
                errorLog: error.message
            }
        });

        await caseController.notifyDoctorCaseReady(caseId);
    }
};