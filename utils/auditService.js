const AuditLog = require('../models/AuditLog');

exports.logAction = async (userId, action, req) => {
    await AuditLog.create({
        userId,
        action,
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent']
    });
};