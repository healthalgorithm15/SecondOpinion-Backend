const nodemailer = require('nodemailer');

/**
 * 📧 Gmail SMTP Provider
 * Requires a 16-digit Google App Password
 */
module.exports = async (options) => {
    // 1. Dev Mode check
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || process.env.NODE_ENV === 'development') {
        console.log(`\n📧 [EMAIL SIMULATOR] To: ${options.email} | Subject: ${options.subject}`);
        console.log(`Message: ${options.message}\n`);
        return true;
    }

    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // Use SSL for Azure reliability
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS, 
        },
    });

    const mailOptions = {
        from: `"PramanAI Support" <${process.env.EMAIL_USER}>`,
        to: options.email,
        subject: options.subject,
        html: options.message,
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email delivered:', info.messageId);
        return true;
    } catch (error) {
        console.error('❌ Email Error (SMTP):', error.message);
        throw new Error('Email delivery failed');
    }
};