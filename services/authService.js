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
 * Professional Registration Logic
 */
exports.registerUser = async (userData) => {
    let { name, email, mobile, password, identifier, role } = userData;

    // SANITIZATION: Prevents "duplicate key error" for empty fields
    if (mobile === "" || (typeof mobile === 'string' && mobile.trim() === "")) mobile = undefined;
    if (email === "" || (typeof email === 'string' && email.trim() === "")) email = email?.toLowerCase().trim();

    // Identifier Logic if fields are missing
    if (identifier && !email && !mobile) {
        if (identifier.includes('@')) { email = identifier.toLowerCase().trim(); } 
        else { mobile = identifier.trim(); }
    }

    if (!email && !mobile) throw new Error('Email or Mobile required');

    const criteria = [];
    if (email) criteria.push({ email });
    if (mobile) criteria.push({ mobile });

    const userExists = await User.findOne({ $or: criteria });
    if (userExists) {
        const field = userExists.email === email ? 'Email' : 'Mobile number';
        throw new Error(`${field} is already registered to another account`);
    }

    // MFA Selection during signup
    let otp = undefined;
    let otpExpire = undefined;
    let emailToken = undefined;

    if (mobile) {
        otp = crypto.randomInt(100000, 999999).toString();
        otpExpire = Date.now() + 10 * 60 * 1000;
    } else if (email) {
        emailToken = crypto.randomBytes(32).toString('hex');
    }

    // 🛡️ PROD FIX: Send PLAIN text password. 
    // Your User Model will hash it once in the pre('save') hook.
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
 * Login: Standard MFA Flow
 */
exports.loginUser = async (identifier, password) => {
    // Normalize identifier for search
    const cleanId = identifier.toLowerCase().trim();

    // 1. Find user and explicitly include password (since it's select: false in Model)
    const user = await User.findOne({
        $or: [{ email: cleanId }, { mobile: identifier.trim() }]
    }).select('+password');

    console.log("Attempting login for:", cleanId);
    console.log("User found in DB:", user ? "YES" : "NO");

    // 2. Use the Model's helper method or direct bcrypt comparison
    if (!user || !(await bcrypt.compare(password, user.password))) {
        throw new Error('Invalid credentials');
    }

    // 3. Generate login OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    
    // 🛡️ PROD FIX: Use findByIdAndUpdate to update OTP.
    // This prevents the pre('save') hook from accidentally re-hashing the password.
    await User.findByIdAndUpdate(user._id, {
        otp,
        otpExpire: Date.now() + 10 * 60 * 1000
    });

    return { user, otp };
};

/**
 * Verify OTP
 */
exports.verifyOTP = async (identifier, otp, mode = 'login') => {
    let user;
    const cleanId = identifier.toLowerCase().trim();

    if (mode === 'reset') {
        user = await User.findOne({
            $or: [{ email: cleanId }, { mobile: identifier.trim() }],
            passwordResetOtp: otp,
            passwordResetExpires: { $gt: Date.now() }
        });
        if (!user) throw new Error("Invalid or expired reset code");
    } else {
        // Explicitly select otp fields since they are select: false in schema
        user = await User.findOne({ 
            $or: [{ email: cleanId }, { mobile: identifier.trim() }] 
        }).select('+otp +otpExpire');

        if (!user || user.otp !== otp || user.otpExpire < Date.now()) {
            throw new Error('Invalid or expired OTP');
        }

        // Use findByIdAndUpdate to activate without triggering password middleware
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
 * Reset Password Logic
 */
exports.resetPassword = async (identifier, otp, newPassword) => {
    const cleanId = identifier.toLowerCase().trim();
    const user = await User.findOne({
        $or: [{ email: cleanId }, { mobile: identifier.trim() }],
        passwordResetOtp: otp,
        passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) throw new Error("Reset session expired. Please request a new code.");

    // 🛡️ PROD FIX: Set plain text. 
    // The .save() call will trigger the Model's pre-save hash hook.
    user.password = newPassword; 
    user.passwordResetOtp = undefined;
    user.passwordResetExpires = undefined;

    await user.save();
    return user;
};


/**
 * Google Auth Logic
 */
exports.googleAuth = async (idToken) => {
    const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const { name, email, sub: googleId } = ticket.getPayload();

    let user = await User.findOne({ $or: [{ googleId }, { email }] });
    if (!user) {
        user = await User.create({
            name, email, googleId,
            authMethod: 'google', isEmailVerified: true,
            isVerified: true, 
            consent: { hasAgreed: true, agreedAt: Date.now() }
        });
    }
    return user;
};

/**
 * Verify Email Link (for Email-based registration)
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
 * Get User Profile
 */
exports.getUserProfile = async (userId) => {
    const user = await User.findById(userId).select('-password'); // Never return the password
    if (!user) throw new Error('User not found');
    return user;
};