const User = require('../models/User');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Helper: Hash a plain text token for database storage
 */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * 1. Professional Registration Logic
 */
exports.registerUser = async (userData) => {
    let { name, email, mobile, password, identifier, role } = userData;

    // SANITIZATION: Ensure empty strings don't trigger unique index collisions
    email = (email && email.trim() !== "") ? email.toLowerCase().trim() : undefined;
    mobile = (mobile && mobile.trim() !== "") ? mobile.trim() : undefined;

    // Auto-detect identifier type if specific fields are missing
    if (identifier && !email && !mobile) {
        if (identifier.includes('@')) { 
            email = identifier.toLowerCase().trim(); 
        } else { 
            mobile = identifier.trim(); 
        }
    }

    if (!email && !mobile) throw new Error('Email or Mobile number is required');

    // Check for existing users
    const criteria = [];
    if (email) criteria.push({ email });
    if (mobile) criteria.push({ mobile });

    const userExists = await User.findOne({ $or: criteria });
    if (userExists) {
        const field = userExists.email === email ? 'Email' : 'Mobile number';
        throw new Error(`${field} is already registered to another account`);
    }

    // Generate Verification Data
    let otp = undefined;
    let otpExpire = undefined;
    let emailToken = undefined;

    if (mobile) {
        otp = crypto.randomInt(100000, 999999).toString();
        otpExpire = Date.now() + 10 * 60 * 1000;
    } else if (email) {
        emailToken = crypto.randomBytes(32).toString('hex');
    }

    // Create User (Model's pre-save hook handles the hashing)
    const user = await User.create({
        name,
        email,
        mobile,
        password, 
        role: role || 'patient',
        otp, 
        otpExpire,
        emailToken: emailToken ? hashToken(emailToken) : undefined, 
        authMethod: 'local',
        consent: { hasAgreed: true, agreedAt: Date.now() }
    });

    return { user, otp, emailToken };
};

/**
 * 2. Login Logic
 */
exports.loginUser = async (identifier, password) => {
    const cleanId = identifier.trim();
    const searchId = cleanId.toLowerCase();

    // Find user and include hidden password
    const user = await User.findOne({
        $or: [{ email: searchId }, { mobile: cleanId }]
    }).select('+password');

    if (!user || !(await bcrypt.compare(password, user.password))) {
        throw new Error('Invalid credentials');
    }

    // Generate Login OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    
    // 🛡️ Bypasses pre-save hooks to prevent password re-hashing
    await User.findByIdAndUpdate(user._id, {
        otp,
        otpExpire: Date.now() + 10 * 60 * 1000
    });

    return { user, otp };
};

/**
 * 3. Unified OTP Verification
 */
exports.verifyOTP = async (identifier, otp, mode = 'login') => {
    const cleanId = identifier.trim();
    const searchId = cleanId.toLowerCase();
    let user;

    if (mode === 'reset') {
        // 1. Find the user with the reset OTP
        user = await User.findOne({
            $or: [{ email: searchId }, { mobile: cleanId }],
            passwordResetOtp: otp,
            passwordResetExpires: { $gt: Date.now() }
        });
        
        if (!user) throw new Error("Invalid or expired reset code");

        // ✅ OPTIONAL: You can clear it now, or wait until resetPassword is called.
        // I recommend waiting until resetPassword is called (which you already do).
        
    } else {
        // 2. Standard Login/Signup OTP
        user = await User.findOne({ 
            $or: [{ email: searchId }, { mobile: cleanId }] 
        }).select('+otp +otpExpire');

        if (!user || user.otp !== otp || user.otpExpire < Date.now()) {
            throw new Error('Invalid or expired OTP');
        }

        user = await User.findByIdAndUpdate(user._id, {
            isVerified: true,
            isEmailVerified: !!user.email,
            otp: undefined,
            otpExpire: undefined
        }, { new: true });
    }

    return user;
};
/**
 * Helper: Check Cooldown and Attempt Limits
 * This prevents OTP spamming and brute force attempts.
 */
const validateOtpRequest = (user) => {
    const COOLDOWN_TIME = 60 * 1000; // 1 minute
    const MAX_ATTEMPTS = 5;

    // 1. Check Hard Attempt Limit
    if (user.otpResendCount >= MAX_ATTEMPTS) {
        throw new Error('Maximum OTP attempts reached. Please try again in 1 hour.');
    }

    // 2. Check Cooldown (Time passed since lastOtpSentAt)
    if (user.lastOtpSentAt) {
        const timePassed = Date.now() - new Date(user.lastOtpSentAt).getTime();
        if (timePassed < COOLDOWN_TIME) {
            const waitTime = Math.ceil((COOLDOWN_TIME - timePassed) / 1000);
            throw new Error(`Please wait ${waitTime} seconds before requesting a new code.`);
        }
    }
};

/**
 * 4. Forgot Password Logic (Updated with Rate Limiting)
 */
exports.forgotPassword = async (identifier) => {
    const cleanId = identifier.trim().toLowerCase();
    
    const user = await User.findOne({
        $or: [{ email: cleanId }, { mobile: identifier.trim() }]
    });

    if (!user) throw new Error('No user found with this email or mobile number');

    // 🛡️ Validate Cooldown/Attempts
    validateOtpRequest(user);

    const resetOtp = crypto.randomInt(100000, 999999).toString();
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Save to User model
    user.passwordResetOtp = resetOtp;
    user.passwordResetToken = hashToken(resetToken);
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 Minute Expiry (Standard)
    
    // 🛡️ Update Rate Limit Fields
    user.lastOtpSentAt = Date.now();
    user.otpResendCount += 1;

    await user.save({ validateBeforeSave: false });

    return { user, resetToken, resetOtp };
};
/**
 * Reset Password (Cleanup logic)
 * When password is reset successfully, we should reset the resend count.
 */
exports.resetPassword = async (identifier, otp, newPassword) => {
    const cleanId = identifier.trim().toLowerCase();
    
    const user = await User.findOne({
        $or: [{ email: cleanId }, { mobile: identifier.trim() }],
        passwordResetOtp: otp,
        passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) throw new Error("Reset session expired. Please request a new code.");

    user.password = newPassword; 
    user.passwordResetOtp = undefined;
    user.passwordResetExpires = undefined;
    
    // 🛡️ Reset the counter so they aren't blocked next time they forget
    user.otpResendCount = 0;
    user.lastOtpSentAt = null;

    await user.save();
    return user;
};

/**
 * Resend OTP Logic (Updated with Rate Limiting)
 */
exports.resendOTP = async (identifier) => {
    const cleanId = identifier.trim().toLowerCase();
    
    const user = await User.findOne({
        $or: [{ email: cleanId }, { mobile: identifier.trim() }]
    });

    if (!user) throw new Error('No user found with this identifier');

    // 🛡️ Validate Cooldown/Attempts
    validateOtpRequest(user);

    const newOtp = crypto.randomInt(100000, 999999).toString();
    
    // Standardize to 10-minute expiry for consistency
    user.passwordResetOtp = newOtp;
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000; 
    
    // 🛡️ Update Rate Limit Fields
    user.lastOtpSentAt = Date.now();
    user.otpResendCount += 1;

    await user.save({ validateBeforeSave: false });

    return { user, newOtp };
};

/**
 * 5. Google Auth
 */
exports.googleAuth = async (idToken) => {
    const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const { name, email, sub: googleId } = ticket.getPayload();

    let user = await User.findOne({ $or: [{ googleId }, { email: email.toLowerCase() }] });
    
    if (!user) {
        user = await User.create({
            name, 
            email: email.toLowerCase(), 
            googleId,
            authMethod: 'google', 
            isEmailVerified: true,
            isVerified: true, 
            consent: { hasAgreed: true, agreedAt: Date.now() }
        });
    }
    return user;
};

/**
 * 6. Verify Email Link
 */
exports.verifyEmailToken = async (token) => {
    const hashedToken = hashToken(token);
    const user = await User.findOne({ emailToken: hashedToken });

    if (!user) throw new Error('Invalid or expired verification link');

    user.isEmailVerified = true;
    user.isVerified = true;
    user.emailToken = undefined; 
    await user.save();

    return user;
};

/**
 * 7. Get User Profile
 */
exports.getUserProfile = async (userId) => {
    const user = await User.findById(userId).select('-password');
    if (!user) throw new Error('User not found');
    return user;
};