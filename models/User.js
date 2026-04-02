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
        unique: true, 
        sparse: true, 
        lowercase: true, 
        trim: true 
    },
    mobile: { 
        type: String, 
        unique: true, 
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
    mciNumber: { type: String, unique: true, sparse: true },
    experienceYears: { type: Number },

    // Security Tokens (Hidden from standard queries by default)
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
 * Hashes the password before saving if it has been modified.
 * Note: Use 'next' to ensure the async chain completes correctly.
 */
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(12); // Slightly stronger salt for production
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

/**
 * 🔑 HELPER METHOD
 * Compares plain text password with hashed password in DB
 */
userSchema.methods.comparePassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

/**
 * ⚡ INDEXING
 * Using separate indexes for Email and Mobile is more efficient for $or queries.
 */
userSchema.index({ email: 1 });
userSchema.index({ mobile: 1 });
userSchema.index({ mciNumber: 1 }); // Important for doctor verification searches

module.exports = mongoose.model('User', userSchema);