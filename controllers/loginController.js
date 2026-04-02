const authService = require('../services/authService');
const auditService = require('../services/auditService');
const sendSMS = require('../utils/smsProvider');
const sendEmail = require('../utils/emailProvider');
const { generateToken } = require('../utils/tokenHelper');

/**
 * 1. Login Initiation: Validates credentials and sends OTP
 */
exports.login = async (req, res) => {
    try {
        const { identifier, password } = req.body;
        console.log("Login attempt for:", identifier);
        
        // Authenticate via service
        const { user, otp } = await authService.loginUser(identifier, password);
        
        // 🛑 SECURITY CHECK: Block if account is not verified (Email users)
        if (user.email && !user.isEmailVerified) {
            return res.status(403).json({ 
                success: false, 
                message: 'Account not verified. Please check your email for the verification link.' 
            });
        }

        // 🟢 NOTIFICATION BLOCK: Provider failures won't block the response
        try {
            if (user.mobile) {
                await sendSMS(user.mobile, `Your PramanAI login code is: ${otp}`);
            }

            if (user.email) {
                await sendEmail({
                    email: user.email,
                    subject: 'Your Login OTP',
                    message: `<p>Your code is: <strong>${otp}</strong>. It will expire in 10 minutes.</p>`
                });
            }
        } catch (providerError) {
            console.error("Notification Delivery Failed:", providerError.message);
            // We continue so the user can still proceed (useful for local dev/testing)
        }

        res.status(200).json({ 
            success: true, 
            message: 'OTP sent to your registered device' 
        });

    } catch (err) { 
        console.error("Login Controller Error:", err.message);
        // This ensures "Invalid credentials" or other service errors reach the app
        res.status(401).json({ success: false, message: err.message }); 
    }
};

/**
 * 2. Unified OTP Verification
 */
exports.verifyOTP = async (req, res) => {
    try {
        const { identifier, otp, mode } = req.body;

        if (mode === 'reset') {
            await authService.verifyOTP(identifier, otp, 'reset');
            return res.status(200).json({ 
                success: true, 
                message: 'Reset code verified. Proceed to update password.' 
            });
        } else {
            const user = await authService.verifyOTP(identifier, otp);
            await auditService.logAction(user._id, 'LOGIN_SUCCESS', req);

            return res.status(200).json({ 
                success: true, 
                token: generateToken(user._id), 
                user: {
                    _id: user._id,
                    name: user.name,
                    role: user.role,
                    isFirstLogin: user.isFirstLogin
                } 
            });
        }
    } catch (err) {
        res.status(400).json({ success: false, message: err.message }); 
    }
};

/**
 * 3. Google OAuth Login
 */
exports.googleLogin = async (req, res) => {
    try {
        const { idToken } = req.body;
        const user = await authService.googleAuth(idToken);
        await auditService.logAction(user._id, 'GOOGLE_LOGIN_SUCCESS', req);
        
        res.status(200).json({
            success: true,
            token: generateToken(user._id),
            user: {
                _id: user._id,
                name: user.name,
                role: user.role,
                isFirstLogin: user.isFirstLogin
            }
        });
    } catch (err) { 
        res.status(401).json({ success: false, message: err.message }); 
    }
};

/**
 * 4. Get Current User Profile
 */
exports.getProfile = async (req, res) => {
    try {
        // req.user._id comes from your protect/auth middleware
        const user = await authService.getUserProfile(req.user._id);
        
        res.status(200).json({
            success: true,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                mobile: user.mobile,
                role: user.role,
                isEmailVerified: user.isEmailVerified,
                isProfileApproved: user.isProfileApproved
            }
        });
    } catch (err) {
        res.status(404).json({ success: false, message: err.message });
    }
};