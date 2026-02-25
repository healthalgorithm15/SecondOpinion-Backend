const User = require('../models/User'); // 🛡️ CRITICAL IMPORT ADDED
const authService = require('../services/authService');
const sendSMS = require('../utils/smsProvider');
const sendEmail = require('../utils/emailProvider');

// 1. REGISTER NEW USER (Admin/Patient/Doctor)
exports.register = async (req, res) => {
    console.log("BODY ARRIVED AT CONTROLLER:", req.body);
    try {
        const { user, otp, emailToken } = await authService.registerUser(req.body);

        const host = process.env.APP_URL || 'http://localhost:5000';

        // Send OTP via SMS
        if (otp && user.mobile) {
            sendSMS(user.mobile, `Your verification code is: ${otp}`)
                .catch(err => console.error("SMS Send Error:", err.message));
        }

        // Send Verification Email
        if (emailToken && user.email) {
            const url = `${host}/api/auth/verify-email/${emailToken}`;
            sendEmail({ 
                email: user.email, 
                subject: 'Verify Your Health Account', 
                message: `<p>Please click <a href="${url}">here</a> to verify.</p>` 
            }).catch(err => console.error("Email Send Error:", err.message));
        }
        
        res.status(201).json({ 
            success: true, 
            message: otp ? 'OTP sent to your mobile.' : 'Verification link sent to your email.',
            debug: process.env.NODE_ENV === 'development' ? { otp, emailToken } : undefined
        });

    } catch (err) { 
        res.status(400).json({ success: false, message: err.message }); 
    }
};

// 2. VERIFY EMAIL (Browser or Postman)
exports.verifyEmail = async (req, res) => {
    try {
        await authService.verifyEmailToken(req.params.token);
        
        const isJSONRequest = req.headers['user-agent']?.includes('Postman') || 
                             req.headers['accept']?.includes('json');

        if (isJSONRequest) {
            return res.status(200).json({ success: true, message: "Email verified successfully!" });
        }

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/login?verified=true`);

    } catch (err) {
        res.status(400).send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h1 style="color:red">Verification Failed</h1>
                <p>${err.message}</p>
                <a href="${process.env.FRONTEND_URL || '#'}/resend-verification" style="color: blue;">Try resending link</a>
            </div>
        `);
    }
};

// 3. COMPLETE ONBOARDING (For Doctors/Admins first login)
exports.completeOnboarding = async (req, res) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ success: false, message: "Please provide a password with at least 8 characters." });
        }
        
        // Now 'User' is defined and findById will work!
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        user.password = newPassword; 
        user.isFirstLogin = false;
        
        await user.save();

        res.status(200).json({
            success: true,
            message: "Password updated successfully. Onboarding complete!"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};