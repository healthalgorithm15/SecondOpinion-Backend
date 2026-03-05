const { Expo } = require('expo-server-sdk');
let expo = new Expo();

// 1. PASTE YOUR PHONE'S PUSH TOKEN HERE (Get this from your MongoDB User collection)
const PUSH_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'; 

// 2. PASTE A REAL CASE ID FROM YOUR DATABASE
const CASE_ID = '65af...your_case_id_here'; 

const sendTest = async () => {
  if (!Expo.isExpoPushToken(PUSH_TOKEN)) {
    console.error("Invalid Token");
    return;
  }

  const messages = [{
    to: PUSH_TOKEN,
    sound: 'default',
    title: 'Medical Report Ready! ✅ (Test)',
    body: 'Your specialist has finished the review. Tap to see the results.',
    data: { 
        caseId: CASE_ID, 
        screen: 'case-summary' // This triggers your new logic in _layout.tsx
    },
    priority: 'high'
  }];

  let chunks = expo.chunkPushNotifications(messages);
  for (let chunk of chunks) {
    try {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log("✅ Notification Sent! Check your phone.", ticketChunk);
    } catch (error) {
      console.error("❌ Error:", error);
    }
  }
};

sendTest();