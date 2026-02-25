require('dotenv').config();

/**
 * 🛡️ Validation: Ensure the app doesn't start without critical environment variables.
 * This prevents "undefined" errors deep in your code.
 */
const requiredEnvs = [
    'MONGO_URI', 
    'JWT_SECRET', 
    'APP_URL'
];

// Add AI-specific requirements based on the environment
if (process.env.NODE_ENV === 'production') {
    if (process.env.USE_VERTEX === 'true') {
        requiredEnvs.push('GCP_PROJECT_ID');
    } else {
        requiredEnvs.push('GEMINI_API_KEY');
    }
}

// 🛡️ Run the check
requiredEnvs.forEach((envName) => {
    if (!process.env[envName]) {
        console.error(`❌ FATAL ERROR: ${envName} is missing in .env file.`);
        process.exit(1); // Stop the server immediately
    }
});

/**
 * 🚀 Centralized Configuration Object
 */
const config = {
    // Basic App Settings
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 5000,
    appUrl: process.env.APP_URL, // e.g., http://192.168.1.20:5000
    frontendUrl: process.env.FRONTEND_URL,

    // Database
    db: {
        uri: process.env.MONGO_URI,
    },

    // Authentication
    jwt: {
        secret: process.env.JWT_SECRET,
        expire: process.env.JWT_EXPIRE || '1d',
    },

    // AI Pipeline Settings (Production-Ready for India)
    ai: {
        useVertex: process.env.USE_VERTEX === 'true', 
        apiKey: process.env.GEMINI_API_KEY,
        gcpProjectId: process.env.GCP_PROJECT_ID,
        gcpLocation: process.env.GCP_LOCATION || 'asia-south1', // Default to Mumbai
    },

    // Storage Strategy
    storageMode: process.env.STORAGE_MODE || 'LOCAL',

    // Email (Nodemailer)
    email: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
    }
};

module.exports = config;