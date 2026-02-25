const User = require('../models/User');


exports.createDoctor = async (req, res) => {
    try {
        const { name, email, mobile, specialization, mciNumber } = req.body;

        // ... existence checks ...

        const rawTempPassword = `Praman@${Math.floor(1000 + Math.random() * 9000)}`;

        const doctor = await User.create({
            name,
            email,
            mobile,
            specialization,
            mciNumber,
            password: rawTempPassword, // 👈 PASS RAW PASSWORD. The pre-save hook will hash it!
            role: 'doctor',
            isVerified: true,
            isEmailVerified: true,
            isProfileApproved: true,
            isFirstLogin: true 
        });

        res.status(201).json({
            success: true,
            message: "Doctor account created successfully",
            data: {
                email: doctor.email,
                tempPassword: rawTempPassword // Use this to tell the admin what code to give the doctor
            }
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};