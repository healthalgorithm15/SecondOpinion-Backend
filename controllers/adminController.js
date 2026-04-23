const adminService = require('../services/adminService');
const Transaction = require('../models/Transaction');
const sendEmail = require('../utils/emailProvider');

/**
 * @desc    Create Medical Staff (Doctor or CMO)
 * @route   POST /api/admin/create-staff
 */
exports.createMedicalStaff = async (req, res) => {
    try {
        // 1. Capture role from request, default to doctor
        const { role = 'doctor', email, name } = req.body;

        // 2. Create account in DB via service
        // Ensure your adminService.createDoctorAccount is updated to handle 'role'
        const result = await adminService.createDoctorAccount({ ...req.body, role });
        const { doctor, rawTempPassword } = result;

        // 3. Construct professional HTML message
        const welcomeMessage = `
            <div style="font-family: sans-serif; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                <h2 style="color: #007bff;">Welcome to PramanAI</h2>
                <p>Hello Dr. ${name},</p>
                <p>Your medical staff account has been successfully created with the role of <b>${role.toUpperCase()}</b>.</p>
                <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <p style="margin: 0;"><strong>Email:</strong> ${email}</p>
                    <p style="margin: 5px 0 0 0;"><strong>Temporary Password:</strong> <span style="color: #d9534f; font-weight: bold;">${rawTempPassword}</span></p>
                </div>
                <p>Please use the credentials to log in to the PramanAI mobile app. You will be prompted to set a permanent password upon your first login.</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="font-size: 12px; color: #777;">This is an automated message. Please do not reply to this email.</p>
            </div>
        `;

        // 4. Trigger the email using your existing provider
        await sendEmail({
            email: doctor.email,
            subject: `PramanAI Account Created - ${role.toUpperCase()}`,
            message: welcomeMessage
        });

        res.status(201).json({ 
            success: true, 
            message: `${role} account created and welcome email sent.`, 
            data: { 
                id: doctor._id,
                email: doctor.email, 
                role: doctor.role 
            } 
        });

    } catch (error) {
        console.error("Staff Creation Error:", error);
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Fetch All Cases (Modified for Admin/CMO view)
 */
exports.getAllCases = async (req, res) => {
    try {
        const cases = await adminService.fetchAllCases();
        res.status(200).json({ success: true, data: cases });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ... rest of your controller functions (getDashboard, getAllUsers, etc.) remain the same
exports.getAdminDashboard = async (req, res) => {
    try {
        const [users, cases, finance] = await adminService.getDashboardStats();
        res.status(200).json({ success: true, data: { users, cases, finance } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const users = await adminService.fetchAllUsers(req.query.role);
        res.status(200).json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



exports.assignDoctorToCase = async (req, res) => {
    try {
        const updatedCase = await adminService.updateCaseDoctor(req.body.caseId, req.body.doctorId);
        res.status(200).json({ success: true, message: `Assigned to Dr. ${updatedCase.doctorId.name}`, data: updatedCase });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Inside adminController.js
exports.getTransactions = async (req, res) => {
    try {
        const transactions = await adminService.fetchAllTransactions();
        res.status(200).json({ success: true, data: transactions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.verifyPaymentManually = async (req, res) => {
    try {
        const transaction = await adminService.verifyTransactionManually(req.body.transactionId);
        res.status(200).json({ success: true, message: "Payment verified", data: transaction });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};