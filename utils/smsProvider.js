const axios = require('axios');

module.exports = async (mobile, otp) => {
  if (!process.env.MSG91_AUTH_KEY) {
    return console.log(`\n--- [DEV MODE] OTP for ${mobile}: [ ${otp} ] ---\n`);
  }
  try {
    await axios.post('https://control.msg91.com/api/v5/otp', null, {
      params: {
        template_id: process.env.MSG91_TEMPLATE_ID,
        mobile,
        authkey: process.env.MSG91_AUTH_KEY,
        otp
      }
    });
  } catch (error) {
    console.error('SMS Error:', error.message);
  }
};