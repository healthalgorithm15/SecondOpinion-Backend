const AuditLog = require('../models/AuditLog');

/**
 * @desc    Logs a user action to the database
 * @param   {string} userId - The ID of the user performing the action
 * @param   {string} action - The type of action (e.g., 'LOGIN_SUCCESS', 'LOGOUT')
 * @param   {object} req - The request object to extract IP and User Agent
 */
exports.logAction = async (userId, action, req) => {
    try {
        await AuditLog.create({
            userId,
            action,
            ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            timestamp: new Date()
        });
    } catch (err) {
        // We console.error but don't throw, so the user's login isn't blocked 
        // just because the logging failed.
        console.error('Audit Logging Failed:', err.message);
    }
};