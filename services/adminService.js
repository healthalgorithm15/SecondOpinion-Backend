const User = require('../models/User');
const ReviewCase = require('../models/ReviewCase');
const Transaction = require('../models/Transaction');

class AdminService {
    // 1. Create Doctor Logic
    async createDoctorAccount(data) {
        const { name, email, mobile, specialization, mciNumber } = data;

        const existingUser = await User.findOne({ $or: [{ email }, { mobile }, { mciNumber }] });
        if (existingUser) throw new Error("Doctor with this email, mobile, or MCI already exists");

        const rawTempPassword = `Praman@${Math.floor(1000 + Math.random() * 9000)}`;

        const doctor = await User.create({
            name, email, mobile, specialization, mciNumber,
            password: rawTempPassword,
            role: 'doctor',
            isVerified: true,
            isEmailVerified: true,
            isProfileApproved: true,
            isFirstLogin: true 
        });

        return { doctor, rawTempPassword };
    }

    // 2. Dashboard Stats Aggregation
    async getDashboardStats() {
        return await Promise.all([
            User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
            ReviewCase.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
            Transaction.aggregate([{ $group: { _id: "$status", total: { $sum: "$amount" }, count: { $sum: 1 } } }])
        ]);
    }

    // 3. User Directory
    async fetchAllUsers(role) {
        const filter = role ? { role } : {};
        return await User.find(filter).sort({ createdAt: -1 });
    }

    // 4. Case History
    async fetchAllCases() {
        return await ReviewCase.find()
            .populate('patientId', 'name email mobile')
            .populate('doctorId', 'name specialization mciNumber')
            .sort({ createdAt: -1 });
    }

    // 5. Reassign Doctor
    async updateCaseDoctor(caseId, doctorId) {
        const updatedCase = await ReviewCase.findByIdAndUpdate(
            caseId,
            { doctorId, status: 'PENDING_DOCTOR' },
            { new: true }
        ).populate('doctorId', 'name');
        
        if (!updatedCase) throw new Error("Case not found");
        return updatedCase;
    }

    // 6. Manual Payment Verification
    async verifyTransactionManually(transactionId) {
        const transaction = await Transaction.findByIdAndUpdate(
            transactionId,
            { status: 'paid', verifiedBy: 'admin_manual', paidAt: Date.now() },
            { new: true }
        );
        
        if (!transaction) throw new Error("Transaction not found");
        return transaction;
    }
}

module.exports = new AdminService();