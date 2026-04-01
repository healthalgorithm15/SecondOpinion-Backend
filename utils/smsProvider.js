const axios = require('axios');

/**
 * 📱 Mobile Number Sanitizer for MSG91
 */
const sanitizeMobile = (mobile) => {
    let cleaned = mobile.replace(/\D/g, '');
    if (cleaned.length === 10) {
        cleaned = `91${cleaned}`;
    }
    if (cleaned.startsWith('00')) {
        cleaned = cleaned.substring(2);
    } else if (cleaned.startsWith('0')) {
        cleaned = cleaned.substring(1);
    }
    return cleaned;
};

/**
 * 🚀 Main SMS Provider
 */
module.exports = async (mobile, otp) => {
    // 1. Dev Mode / Environment Check
    if (!process.env.MSG91_AUTH_KEY || process.env.NODE_ENV === 'development') {
        console.log(`\n📱 [SMS SIMULATOR] To: ${mobile} | Code: ${otp} \n`);
        return true; 
    }

    const finalMobile = sanitizeMobile(mobile);
    const numericOtp = Number(otp.toString().replace(/\D/g, ''));

    console.log(`\n📤 Attempting SMS to: ${finalMobile}`);

    try {
        const response = await axios.post('https://control.msg91.com/api/v5/otp', null, {
            params: {
                template_id: process.env.MSG91_TEMPLATE_ID,
                mobile: finalMobile,
                authkey: process.env.MSG91_AUTH_KEY,
                otp: numericOtp,
            }
        });

        console.log("--- MSG91 DEBUG ---");
        console.log("Status:", response.status);
        console.log("Response:", response.data);
        console.log("-------------------");

        if (response.data.type === 'error') {
            throw new Error(response.data.message || 'MSG91 Validation Failed');
        }

        console.log(`✅ SMS sent successfully to ${finalMobile}`);
        return true;

    } catch (error) {
        const detailedError = error.response?.data?.message || error.message;
        console.error('❌ SMS Delivery Failed:', detailedError);
        throw new Error(`SMS service unavailable: ${detailedError}`);
    }
};