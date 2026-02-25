const authService = require('../services/authService');
const sendSMS = require('../utils/smsProvider');
const sendEmail = require('../utils/emailProvider');

exports.forgotPassword = async (req, res) => {
    try {
        const { identifier } = req.body;
        const { user, resetToken, resetOtp } = await authService.forgotPassword(identifier);

        const isEmailInput = identifier.includes('@');

        if (isEmailInput && user.email) {
            const resetUrl = `${req.protocol}://${req.get('host')}/api/auth/reset-password/${resetToken}`;
            await sendEmail({ 
                email: user.email, 
                subject: 'Reset Password', 
                message: `<p>Link: ${resetUrl}</p>` 
            });
            return res.status(200).json({ success: true, message: 'Reset link sent to email' });
        }

        if (!isEmailInput && user.mobile) {
            await sendSMS(user.mobile, `Reset code: ${resetOtp}`);
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