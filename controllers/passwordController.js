const authService = require('../services/authService');
const sendSMS = require('../utils/smsProvider');
const sendEmail = require('../utils/emailProvider');

exports.forgotPassword = async (req, res) => {
    try {
        const { identifier } = req.body;
        const { user, resetOtp } = await authService.forgotPassword(identifier);

        const isEmailInput = identifier.includes('@');

        // ✅ If it's an email, send the OTP (code) instead of a link
        if (isEmailInput && user.email) {
            await sendEmail({ 
                email: user.email, 
                subject: 'PramanAI: Password Reset Code', 
                // We send the 6-digit OTP so the user can type it into the app
                message: `
                    <div style="font-family: sans-serif; padding: 20px;">
                        <h2>Reset Your Password</h2>
                        <p>Use the following code to reset your password in the PramanAI app:</p>
                        <h1 style="color: #1E7D75; letter-spacing: 5px;">${resetOtp}</h1>
                        <p>This code will expire in 15 minutes.</p>
                    </div>
                ` 
            });
            return res.status(200).json({ success: true, message: 'Reset code sent to email' });
        }

        // ✅ If it's mobile, SMS already uses the resetOtp
        if (!isEmailInput && user.mobile) {
            await sendSMS(user.mobile, `Your PramanAI reset code is: ${resetOtp}`);
            return res.status(200).json({ success: true, message: 'Reset code sent to mobile' });
        }

        res.status(200).json({ success: true, message: 'Reset info sent' });

    } catch (err) { 
        res.status(400).json({ success: false, message: err.message }); 
    }
};

exports.resetPassword = async (req, res) => {
    try {
        // 🚀 Added 'password' to destructuring to match frontend payload
        const { identifier, newPassword, password, otp } = req.body; 
        const { token } = req.params; 

        const code = token || otp;
        // 🚀 Use whichever password field is provided by the frontend
        const finalPassword = newPassword || password;

        if (!code) throw new Error("Verification code or token is required");
        if (!finalPassword) throw new Error("New password is required");

        await authService.resetPassword(identifier, code, finalPassword);

        res.status(200).json({ success: true, message: 'Password reset successful' });
    } catch (err) { 
        res.status(400).json({ success: false, message: err.message }); 
    }
};

exports.updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await authService.updatePassword(req.user.id, currentPassword, newPassword);

        if (user.email) {
            await sendEmail({
                email: user.email,
                subject: 'Security Alert: Password Changed',
                message: `<p>Your password was changed on ${new Date().toLocaleString()}.</p>`
            });
        }
        res.status(200).json({ success: true, message: 'Password updated' });
    } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};