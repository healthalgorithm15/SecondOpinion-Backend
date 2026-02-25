const User = require('../models/User');
const Blacklist = require('../models/BlackList');
const auditService = require('../services/auditService');

exports.logout = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(400).json({ message: "No token provided" });

        await Blacklist.create({ token });
        await auditService.logAction(req.user.id, 'LOGOUT', req);

        res.status(200).json({ success: true, message: 'Logged out' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.status(200).json({ success: true, data: user });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};