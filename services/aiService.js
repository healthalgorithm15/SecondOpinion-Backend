const { GoogleGenAI } = require("@google/genai");
const ReviewCase = require('../models/ReviewCase');
const caseController = require('../controllers/caseController');

// 1. Correct SDK Initialization
const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

/**
 * 🛠️ Robust JSON Parser
 * Uses Regex to find the JSON object even if the AI adds text around it.
 */
const parseAIResponse = (text) => {
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
        console.error("Parsing Error:", e);
        return null;
    }
};

/**
 * 🤖 Main Service: Analyzes medical reports with Auto-Retry logic
 * @param {string} caseId - The ID of the case to analyze
 * @param {number} attempt - Current attempt count for model fallbacks
 */
exports.analyzeReports = async (caseId, attempt = 0) => {
    // List of models to try in order of preference
    const MODELS = ["gemini-1.5-flash", "gemini-1.5-pro"];
    const currentModelName = MODELS[attempt] || MODELS[0];

    console.log(`🤖 AI Attempt ${attempt + 1}: Using ${currentModelName} for Case ${caseId}`);

    try {
        const currentCase = await ReviewCase.findById(caseId).populate('recordIds');
        if (!currentCase || !currentCase.recordIds.length) {
            console.error("❌ Case or records missing.");
            return;
        }

        // 2. Initialize the specific model
        const model = genAI.getGenerativeModel({ model: currentModelName });

        // Prepare multimodal data (Base64)
        const fileParts = currentCase.recordIds.map(record => ({
            inlineData: {
                data: record.fileData.toString("base64"),
                mimeType: record.contentType
            }
        }));

        const prompt = `
            SYSTEM: Clinical Assistant. TASK: Extract data.
            RULES: 2-sentence summary. RiskLevel: Low, Medium, High. List key medical markers. 
            Return ONLY raw JSON.
            JSON: {"summary": "string", "riskLevel": "Low|Medium|High", "markers": []}
        `;

        // 3. Generate content with a 30-second safety timeout
        const result = await Promise.race([
            model.generateContent([prompt, ...fileParts]),
            new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 30000))
        ]);

        const response = await result.response;
        const responseText = response.text();
        const structuredData = parseAIResponse(responseText);

        if (!structuredData) throw new Error("INVALID_JSON_FORMAT");

        // 4. Update Database with AI Findings
        const normalizedRisk = (structuredData.riskLevel || 'Low').trim();
        const isHighPriority = normalizedRisk.toLowerCase() === 'high';

        await ReviewCase.findByIdAndUpdate(caseId, {
            aiAnalysis: {
                summary: structuredData.summary,
                riskLevel: normalizedRisk,
                extractedMarkers: structuredData.markers || [],
                analyzedAt: new Date(),
                modelVersion: currentModelName // Useful for auditing
            },
            status: 'PENDING_DOCTOR',
            priority: isHighPriority ? 'High' : 'Normal'
        });

        console.log(`✅ AI Analysis Successful: Case ${caseId}`);
        await caseController.notifyDoctorCaseReady(caseId);

    } catch (error) {
        console.error(`❌ AI Error on ${currentModelName}:`, error.message);

        // 5. AUTO-FALLBACK LOGIC
        // If we have more models to try, move to the next one
        if (attempt < MODELS.length - 1) {
            console.log(`🔄 Attempting fallback to ${MODELS[attempt + 1]}...`);
            return exports.analyzeReports(caseId, attempt + 1);
        }

        // 6. FINAL GRACEFUL DEGRADATION
        // If all AI attempts fail, move to PENDING_DOCTOR with a manual review flag
        console.error("🔥 All AI models failed. Proceeding to Manual Review.");
        
        await ReviewCase.findByIdAndUpdate(caseId, {
            status: 'PENDING_DOCTOR',
            aiAnalysis: {
                summary: 'AI analysis service was unable to process these files. Manual review required.',
                riskLevel: 'Medium',
                analyzedAt: new Date()
            }
        });

        await caseController.notifyDoctorCaseReady(caseId);
    }
};