const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: [true, 'Name is required'], 
        trim: true 
    },
    email: { 
        type: String, 
        unique: true, // 🟢 This automatically creates a unique index
        sparse: true, // Allows multiple nulls (important if some users register with only mobile)
        lowercase: true, 
        trim: true 
    },
    mobile: { 
        type: String, 
        unique: true, // 🟢 Automatically creates a unique index
        sparse: true 
    },
    password: { 
        type: String, 
        required: [true, 'Password is required'], 
        select: false 
    },
    role: { 
        type: String, 
        enum: ['patient', 'doctor', 'admin'], 
        default: 'patient' 
    },
    
    // 🔔 COMMUNICATION & NOTIFICATIONS
    pushToken: { 
        type: String, 
        default: null,
        trim: true
    },
    socketId: { 
        type: String, 
        default: null 
    },

    // Auth & Verification Status
    isFirstLogin: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },
    isProfileApproved: { type: Boolean, default: false },

    // Doctor Specific Fields
    specialization: { type: String },
    mciNumber: { 
        type: String, 
        unique: true, // 🟢 Automatically creates a unique index
        sparse: true 
    },
    experienceYears: { type: Number },

    // Security Tokens
    otp: { type: String, select: false },
    otpExpire: { type: Date, select: false },
    emailToken: { type: String, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetOtp: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    // Compliance & Metadata
    consent: {
        hasAgreed: { type: Boolean, default: false },
        agreedAt: { type: Date }
    },
    authMethod: { 
        type: String, 
        enum: ['local', 'google'], 
        default: 'local' 
    }
}, { 
    timestamps: true 
});

/**
 * 🛡️ ENCRYPTION MIDDLEWARE
 */
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

/**
 * 🔑 HELPER METHOD
 */
userSchema.methods.comparePassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// ⚡ INDEXING NOTES:
// Removed explicit .index() calls for email, mobile, and mciNumber.
// Mongoose creates these automatically due to the 'unique: true' flag above.

module.exports = mongoose.model('User', userSchema);