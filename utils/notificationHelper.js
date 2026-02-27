const axios = require('axios');
const User = require('../models/User');

/**
 * Sends a Push Notification via Expo to all users of a specific role
 */
exports.sendPushToRole = async (role, title, body, data = {}) => {
  try {
    // 1. Find all users with this role who have registered a push token
    const users = await User.find({ 
        role: role, 
        pushToken: { $exists: true, $ne: '' } 
    });

    const tokens = users.map(u => u.pushToken);

    if (tokens.length === 0) {
      console.log(`ℹ️ No push tokens found for role: ${role}`);
      return;
    }

    // 2. Construct the Expo Push payload
    // Expo allows sending up to 100 messages at once in an array
    const messages = tokens.map(token => ({
      to: token,
      sound: 'default',
      title: title,
      body: body,
      data: data, // Useful for deep-linking in the app
      priority: 'high'
    }));

    // 3. Post to Expo's API
    const response = await axios.post('https://exp.host/--/api/v2/push/send', messages, {
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
    });

    console.log(`📡 Expo Push Response:`, response.data);
  } catch (error) {
    console.error("❌ Notification Helper Error:", error.response?.data || error.message);
  }
};