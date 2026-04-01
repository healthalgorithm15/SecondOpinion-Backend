const axios = require('axios');

/**
 * 📱 MSG91 OTP Provider
 * Sends raw numeric OTP to MSG91 API v5
 */
module.exports = async (mobile, otp) => {
    // 1. Dev Mode / Environment Check
    if (!process.env.MSG91_AUTH_KEY || process.env.NODE_ENV === 'development') {
        console.log(`\n📱 [SMS SIMULATOR] To: ${mobile} | Code: ${otp} \n`);
        return true; 
    }

    // 2. Format: Remove '+', spaces, or dashes from phone
    const cleanMobile = mobile.replace(/\D/g, ''); 
    // 3. Extract only numbers from OTP (in case a string was passed)
    const numericOtp = Number(otp.toString().replace(/\D/g, ''));

    try {
        const response = await axios.post('https://control.msg91.com/api/v5/otp', null, {
            params: {
                template_id: process.env.MSG91_TEMPLATE_ID,
                mobile: cleanMobile,
                authkey: process.env.MSG91_AUTH_KEY,
                otp: numericOtp,
            }
        });

        // 4. Validate MSG91 Internal Response (they return 200 even on failures)
        if (response.data.type === 'error') {
            throw new Error(response.data.message || 'MSG91 Validation Failed');
        }

        console.log(`✅ SMS sent successfully to ${cleanMobile}`);
        return true;

    } catch (error) {
        const detailedError = error.response?.data?.message || error.message;
        console.error('❌ SMS Delivery Failed:', detailedError);
        throw new Error(`SMS service temporarily unavailable: ${detailedError}`);
    }
};