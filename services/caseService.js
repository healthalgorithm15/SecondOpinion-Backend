const ReviewCase = require('../models/ReviewCase');
const User = require('../models/User');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

class CaseService {
  /**
   * Logic to transition case from UNASSIGNED to PENDING_DOCTOR
   */
  async assignCaseToSpecialist(caseId, doctorId, assignedBy, note) {
    const updatedCase = await ReviewCase.findByIdAndUpdate(
      caseId,
      {
        assignedTo: doctorId,
        status: 'PENDING_DOCTOR',
        $push: { 
          assignmentHistory: { 
            from: assignedBy, 
            to: doctorId, 
            note: note || "Assigned for specialist review" 
          } 
        }
      },
      { new: true }
    ).populate('patientId');

    if (!updatedCase) throw new Error("Medical case not found");

    // Trigger notification to the specific doctor
    await this.sendTargetedPush(doctorId, {
      title: 'New Case Assigned 🩺',
      body: `You have been assigned ${updatedCase.patientId?.name}'s medical review.`,
      data: { caseId: updatedCase._id.toString(), screen: 'doctor-review' }
    });

    return updatedCase;
  }

  /**
   * Generic helper for sending push notifications using Expo's chunking logic
   */
  async sendTargetedPush(userId, { title, body, data }) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.pushToken || !Expo.isExpoPushToken(user.pushToken)) return;

      const messages = [{
        to: user.pushToken,
        sound: 'default',
        title,
        body,
        data,
        priority: 'high'
      }];

      let chunks = expo.chunkPushNotifications(messages);
      for (let chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
    } catch (error) {
      console.error("Push Service Error:", error);
    }
  }
}

module.exports = new CaseService();