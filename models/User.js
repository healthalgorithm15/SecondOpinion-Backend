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

    // Security Tokens (Hidden by default)
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

// 🛡️ MODERN ENCRYPTION MIDDLEWARE
userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    } catch (error) {
        throw new Error(error);
    }
});

// 🔑 HELPER METHOD
userSchema.methods.comparePassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// ⚡ INDEXING
userSchema.index({ email: 1, mobile: 1 });

module.exports = mongoose.model('User', userSchema);