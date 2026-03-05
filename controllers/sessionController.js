const User = require('../models/User');
const Blacklist = require('../models/BlackList');
const auditService = require('../services/auditService');

/**
 * @desc    Get Current User Profile
 * @route   GET /api/session/me
 */
exports.getMe = async (req, res) => {
    try {
        // req.user.id comes from your auth middleware
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
 * @desc    Update Profile (Critical for Push Notifications)
 * @route   PATCH /api/session/update
 * * NOTE: The frontend should call this whenever the app gains a new 
 * Expo Push Token to ensure the DB is always in sync.
 */
exports.updateProfile = async (req, res) => {
  try {
    const updates = {};
    
    // Support updating the push token for background notifications
    if (req.body.pushToken) updates.pushToken = req.body.pushToken;
    
    // Support basic profile updates
    if (req.body.name) updates.name = req.body.name;
    if (req.body.email) updates.email = req.body.email;

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
 * @route   POST /api/session/logout
 */
exports.logout = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(400).json({ message: "No token provided" });
        }

        // 1. Add token to blacklist to prevent reuse
        await Blacklist.create({ token });

        // 2. Audit the logout action
        await auditService.logAction(req.user.id, 'LOGOUT', req);

        // 3. Optional: Clear pushToken on logout if you don't want 
        // notifications sent to logged-out devices
        // await User.findByIdAndUpdate(req.user.id, { $unset: { pushToken: 1 } });

        res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
};