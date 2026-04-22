const User = require('../models/User');
const ReviewCase = require('../models/ReviewCase');
const Transaction = require('../models/Transaction');

class AdminService {
    /**
     * 🟢 1. CREATE MEDICAL STAFF ACCOUNT
     * Handles both Doctors and CMOs with temporary passwords.
     */
    async createDoctorAccount(data) {
        const { name, email, mobile, specialization, mciNumber, role } = data;

        // Ensure we check for existing users based on available unique fields
        const searchCriteria = [{ email }, { mobile }];
        if (mciNumber) searchCriteria.push({ mciNumber });

        const existingUser = await User.findOne({ $or: searchCriteria });
        if (existingUser) {
            throw new Error("Staff with this email, mobile, or MCI already exists");
        }

        // Generate a secure, readable temporary password
        // Format: Praman@1234
        const rawTempPassword = `Praman@${Math.floor(1000 + Math.random() * 9000)}`;

        const staff = await User.create({
            name,
            email,
            mobile,
            specialization,
            mciNumber: mciNumber || undefined,
            password: rawTempPassword,
            role: role || 'doctor', // 🟢 Dynamic role: 'doctor' or 'cmo'
            isVerified: true,
            isEmailVerified: true,
            isProfileApproved: true,
            isFirstLogin: true // 🟢 Triggers the 'Change Password' flow on frontend
        });

        return { doctor: staff, rawTempPassword };
    }

    /**
     * 📊 2. DASHBOARD STATS AGGREGATION
     */
    async getDashboardStats() {
        return await Promise.all([
            User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
            ReviewCase.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
            Transaction.aggregate([{ $group: { _id: "$status", total: { $sum: "$amount" }, count: { $sum: 1 } } }])
        ]);
    }

    /**
     * 🔍 3. USER DIRECTORY
     */
    async fetchAllUsers(role) {
        const filter = role ? { role } : {};
        return await User.find(filter).sort({ createdAt: -1 });
    }

    /**
     * 📋 4. CASE HISTORY
     */
    async fetchAllCases() {
        return await ReviewCase.find()
            .populate('patientId', 'name email mobile')
            .populate('doctorId', 'name specialization mciNumber')
            .sort({ createdAt: -1 });
    }

    /**
     * 🔄 5. REASSIGN DOCTOR / CASE MANAGEMENT
     */
    async updateCaseDoctor(caseId, doctorId, adminId) {
        const updatedCase = await ReviewCase.findByIdAndUpdate(
            caseId,
            { 
                doctorId, 
                assignedTo: doctorId, 
                status: 'PENDING_DOCTOR',
                $push: { 
                    assignmentHistory: { 
                        from: adminId, 
                        to: doctorId, 
                        note: "Reassigned via Management Panel",
                        timestamp: new Date()
                    } 
                }
            },
            { new: true }
        ).populate('doctorId', 'name specialization');
        
        if (!updatedCase) throw new Error("Case not found");
        return updatedCase;
    }

    /**
     * 💳 6. MANUAL PAYMENT VERIFICATION
     */
    async verifyTransactionManually(transactionId) {
        const transaction = await Transaction.findByIdAndUpdate(
            transactionId,
            { 
                status: 'paid', 
                verifiedBy: 'admin_manual', 
                paidAt: Date.now() 
            },
            { new: true }
        );
        
        if (!transaction) throw new Error("Transaction not found");
        return transaction;
    }

    /**
     * 📑 7. FETCH ALL TRANSACTIONS
     */
    async fetchAllTransactions() {
        return await Transaction.find()
            .populate('patientId', 'name email mobile') 
            .sort({ createdAt: -1 });
    }
}

module.exports = new AdminService();