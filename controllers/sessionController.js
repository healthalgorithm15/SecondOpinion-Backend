const User = require('../models/User');
const Blacklist = require('../models/BlackList');
const auditService = require('../services/auditService');

/**
 * @desc    Get Current User Profile
 * @route   GET /api/auth/me
 */
exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        res.status(200).json({ success: true, data: user });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
};

/**
 * @desc    Update Push Token Only (Dedicated Production Endpoint)
 * @route   PATCH /api/auth/update-push-token
 * 🟢 This fixes the 404 error and keeps the logic isolated
 */
exports.updatePushToken = async (req, res) => {
    try {
        const { pushToken } = req.body;

        if (!pushToken) {
            return res.status(400).json({ success: false, message: "Push token is required" });
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: { pushToken } },
            { new: true }
        ).select('_id pushToken');

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.status(200).json({ 
            success: true, 
            message: "Push token updated", 
            data: { pushToken: user.pushToken } 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Update Profile
 * @route   PATCH /api/auth/profile
 */
exports.updateProfile = async (req, res) => {
  try {
    const updates = {};
    const allowedUpdates = ['name', 'email', 'pushToken']; // Explicitly whitelist fields
    
    Object.keys(req.body).forEach((key) => {
        if (allowedUpdates.includes(key)) {
            updates[key] = req.body[key];
        }
    });

    const user = await User.findByIdAndUpdate(
        req.user.id, 
        { $set: updates }, 
        { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Logout & Invalidate Token
 * @route   POST /api/auth/logout
 */
exports.logout = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(400).json({ message: "No token provided" });
        }

        // 1. Blacklist token
        await Blacklist.create({ token });

        // 2. Audit action
        await auditService.logAction(req.user.id, 'LOGOUT', req);

        // 🟢 PRO TIP: Unset pushToken on logout so the user doesn't get notifications
        // while logged out (standard for privacy-focused medical apps).
        await User.findByIdAndUpdate(req.user.id, { $unset: { pushToken: 1 } });

        res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
};