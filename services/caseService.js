const ReviewCase = require('../models/ReviewCase');
const User = require('../models/User');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

class CaseService {
  /**
   * 🟢 ASSIGN TO SPECIALIST
   * Transitions case from UNASSIGNED to PENDING_DOCTOR.
   * Logs history and notifies the specific doctor.
   */
  async assignCaseToSpecialist(caseId, doctorId, assignedBy, note) {
    // This one line now handles DB update, History, and the Push Notification!
    const updatedCase = await ReviewCase.findByIdAndUpdate(
      caseId,
      {
        assignedTo: doctorId,
        status: 'PENDING_DOCTOR',
        $push: { 
          assignmentHistory: { 
            from: assignedBy, 
            to: doctorId, 
            note: note || "Assigned for specialist review",
            assignedAt: new Date() // ✅ FIXED: Uses assignedAt to align perfectly with your schema model
          } 
        }
      },
      { new: true }
    ).populate('patientId', 'name');

    if (!updatedCase) throw new Error("Medical case not found");

    // 🔔 Trigger notification to the specific doctor
    await this.sendTargetedPush(doctorId, {
      title: 'New Case Assigned 🩺',
      body: `You have been assigned ${updatedCase.patientId?.name || 'a patient'}'s medical review.`,
      data: { 
        caseId: updatedCase._id.toString(), 
        type: 'NEW_ASSIGNMENT',
        screen: 'doctor-review' 
      }
    });

    return updatedCase;
  }

  /**
   * 👑 CMO SELF-ASSIGN
   * Moves the case to the CMO's personal worklist.
   * Bypasses push notification (since the CMO is already in-app).
   */
  async selfAssignCMO(caseId, cmoId) {
    const updatedCase = await ReviewCase.findByIdAndUpdate(
      caseId,
      {
        assignedTo: cmoId,
        status: 'PENDING_DOCTOR',
        $push: { 
          assignmentHistory: { 
            from: cmoId, 
            to: cmoId, 
            note: "CMO self-assigned for direct review.",
            assignedAt: new Date() // ✅ FIXED: Uses assignedAt to align perfectly with your schema model
          } 
        }
      },
      { new: true }
    );

    if (!updatedCase) throw new Error("Medical case not found");
    return updatedCase;
  }

  /**
   * 📢 PUSH NOTIFICATION HELPER
   * Handles Expo token verification and chunked delivery.
   */
  async sendTargetedPush(userId, { title, body, data }) {
    try {
      const user = await User.findById(userId);
      
      // Safety: Only proceed if user exists and has a valid Expo token
      if (!user || !user.pushToken || !Expo.isExpoPushToken(user.pushToken)) {
        console.log(`Skipping push: User ${userId} has no valid Expo token.`);
        return;
      }

      const messages = [{
        to: user.pushToken,
        sound: 'default',
        title,
        body,
        data,
        priority: 'high'
      }];

      // Expo requires chunking for larger lists, but we use it here for robustness
      let chunks = expo.chunkPushNotifications(messages);
      for (let chunk of chunks) {
        try {
          await expo.sendPushNotificationsAsync(chunk);
          console.log(`Push successfully sent to user: ${userId}`);
        } catch (error) {
          console.error("Expo Chunk Delivery Error:", error);
        }
      }
    } catch (error) {
      console.error("General Push Service Error:", error);
    }
  }
}

module.exports = new CaseService();