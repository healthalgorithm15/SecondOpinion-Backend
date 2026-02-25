const nodemailer = require('nodemailer');

module.exports = async (options) => {
  // 1. Dev Mode check (Matching your SMS logic)
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return console.log(`\n--- [DEV MODE] Email OTP for ${options.email}: [ ${options.message} ] ---\n`);
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // Use Google App Password here
    },
  });

  const mailOptions = {
    from: `"Second Opinion" <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    html: options.message,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    // 🟢 PRODUCTION LOGIC: Log it, but don't crash the Login API
    console.error('Email Error (likely SMTP 535):', error.message);
  }
};