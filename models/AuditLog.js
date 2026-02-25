const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    action: { 
        type: String, 
        required: true 
    }, // e.g., 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT'
    ipAddress: String,
    userAgent: String, 
    timestamp: { 
        type: Date, 
        default: Date.now,
        // Automatically delete logs older than 90 days to keep DB clean
        expires: '90d' 
    }
});

module.exports = mongoose.model('AuditLog', auditLogSchema);