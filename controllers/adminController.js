const adminService = require('../services/adminService');
const Transaction = require('../models/Transaction');

exports.createDoctor = async (req, res) => {
    try {
        const result = await adminService.createDoctorAccount(req.body);
        res.status(201).json({ success: true, message: "Doctor account created", data: { email: result.doctor.email, tempPassword: result.rawTempPassword } });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

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

exports.getAllCases = async (req, res) => {
    try {
        const cases = await adminService.fetchAllCases();
        res.status(200).json({ success: true, data: cases });
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