const User = require('../models/User'); 
const authService = require('../services/authService');
const sendSMS = require('../utils/smsProvider');
const sendEmail = require('../utils/emailProvider');

/**
 * 1. REGISTER NEW USER (Admin/Patient/Doctor)
 */
exports.register = async (req, res) => {
    try {
        // Create user via service logic
        const { user, otp, emailToken } = await authService.registerUser(req.body);
        const host = process.env.APP_URL || 'http://localhost:5000';

        // 🟢 ASYNC NOTIFICATIONS
        // We trigger these but don't 'await' them to keep the response fast.
        // Failures are caught and logged without crashing the registration flow.

        // Send OTP via SMS
        if (otp && user.mobile) {
            sendSMS(user.mobile, `Your PramanAI verification code is: ${otp}`)
                .catch(err => console.error("Registration SMS Error:", err.message));
        }

        // Send Verification Email Link
        if (emailToken && user.email) {
            const url = `${host}/api/auth/verify-email/${emailToken}`;
            sendEmail({ 
                email: user.email, 
                subject: 'Verify Your PramanAI Account', 
                message: `
                    <div style="font-family: sans-serif; padding: 20px;">
                        <h2>Welcome to PramanAI</h2>
                        <p>Please click the button below to verify your medical account:</p>
                        <a href="${url}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Account</a>
                        <p>If the button doesn't work, copy this link: ${url}</p>
                    </div>
                ` 
            }).catch(err => console.error("Registration Email Error:", err.message));
        }
        
        res.status(201).json({ 
            success: true, 
            message: otp ? 'Registration successful. OTP sent to mobile.' : 'Registration successful. Verification link sent to email.',
            // Only send debug info in development mode
            debug: process.env.NODE_ENV === 'development' ? { otp, emailToken } : undefined
        });

    } catch (err) { 
        // Catching specific service errors (e.g., "Email already registered")
        res.status(400).json({ success: false, message: err.message }); 
    }
};

/**
 * 2. VERIFY EMAIL (Endpoint triggered by the email link)
 */
exports.verifyEmail = async (req, res) => {
    try {
        await authService.verifyEmailToken(req.params.token);
        
        const isJSONRequest = req.headers['user-agent']?.includes('Postman') || 
                             req.headers['accept']?.includes('json');

        if (isJSONRequest) {
            return res.status(200).json({ success: true, message: "Email verified successfully!" });
        }

        // Redirect to mobile app or frontend login page
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/login?verified=true`);

    } catch (err) {
        res.status(400).send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif; color: #333;">
                <h1 style="color:#d9534f">Verification Failed</h1>
                <p>${err.message}</p>
                <hr style="width: 50%; border: 0; border-top: 1px solid #eee;">
                <p>Need help? <a href="${process.env.FRONTEND_URL || '#'}/support" style="color: #007bff;">Contact Support</a></p>
            </div>
        `);
    }
};

/**
 * 3. COMPLETE ONBOARDING (Force password change on first login)
 */
exports.completeOnboarding = async (req, res) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ 
                success: false, 
                message: "Please provide a password with at least 8 characters." 
            });
        }
        
        // Find user by ID (req.user.id populated by Auth Middleware)
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Updating password triggers the 'pre-save' hashing hook in the Model
        user.password = newPassword; 
        user.isFirstLogin = false;
        
        await user.save();

        res.status(200).json({
            success: true,
            message: "Onboarding complete! Your account is now secured."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};