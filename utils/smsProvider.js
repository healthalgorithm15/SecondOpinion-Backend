const axios = require('axios');

module.exports = async (mobile, otp) => {
  // 1. Dev Mode Fallback
  if (!process.env.MSG91_AUTH_KEY || process.env.NODE_ENV === 'development') {
    console.log(`\n📱 [SMS SIMULATOR] To: ${mobile} | Code: ${otp} \n`);
    return true; 
  }

  // 2. Format Mobile Number (Remove '+' if present)
  const cleanMobile = mobile.replace('+', '');

  try {
    const response = await axios.post('https://control.msg91.com/api/v5/otp', null, {
      params: {
        template_id: process.env.MSG91_TEMPLATE_ID,
        mobile: cleanMobile,
        authkey: process.env.MSG91_AUTH_KEY,
        otp: Number(otp),
        // Optional: add extra variables if your template uses them
        // real_otp: otp 
      }
    });
console.log("✅ SMS sent successfully");
    // 3. MSG91 returns 200 even if it fails internally, check the response type
    if (response.data.type === 'error') {
      throw new Error(`MSG91 Error: ${response.data.message}`);
    }

    return true;

  } catch (error) {
    // 4. Production Logging
    console.error('❌ SMS Delivery Failed:', error.response?.data || error.message);
    
    // In production, you might want to throw the error so the 
    // Controller knows the SMS definitely didn't go out.
    throw new Error('SMS service temporarily unavailable');
  }
};