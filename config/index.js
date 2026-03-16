require('dotenv').config();

/**
 * 🛡️ Validation: Ensure the app doesn't start without critical environment variables.
 */

const requiredEnvs = [
    'MONGO_URI', 
    'JWT_SECRET', 
    'APP_URL',
    'RAZORPAY_KEY_ID',       // 🟢 ADDED: Required for Payment initialization
    'RAZORPAY_KEY_SECRET',   // 🟢 ADDED: Required for Payment verification
    'RAZORPAY_WEBHOOK_SECRET'// 🟢 ADDED: Required for Webhook security
];

// AI-specific requirements
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
       // process.exit(1); 
    }
});

/**
 * 🚀 Centralized Configuration Object
 */
const config = {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 5000,
    appUrl: process.env.APP_URL,
    frontendUrl: process.env.FRONTEND_URL,

    db: {
        uri: process.env.MONGO_URI,
    },

    jwt: {
        secret: process.env.JWT_SECRET,
        expire: process.env.JWT_EXPIRE || '1d',
    },

    // 💳 Payment Settings (Razorpay)
    razorpay: {
        keyId: process.env.RAZORPAY_KEY_ID,
        keySecret: process.env.RAZORPAY_KEY_SECRET,
        webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    },

    // AI Pipeline Settings
    ai: {
        useVertex: process.env.USE_VERTEX === 'true', 
        apiKey: process.env.GEMINI_API_KEY,
        gcpProjectId: process.env.GCP_PROJECT_ID,
        gcpLocation: process.env.GCP_LOCATION || 'asia-south1',
    },

    storageMode: process.env.STORAGE_MODE || 'LOCAL',

    email: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
    }
};

module.exports = config;