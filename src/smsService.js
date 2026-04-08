const twilio = require('twilio');

/**
 * Service to handle SMS delivery via Twilio.
 * Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env
 */
class SMSService {
    constructor() {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        const from = process.env.TWILIO_PHONE_NUMBER;

        if (sid && token) {
            this.client = twilio(sid, token);
            this.from = from;
            console.log("[SMS] Twilio Service Initialized 📱");
        } else {
            console.warn("[SMS] Twilio Credentials missing. SMS will be simulated.");
            this.client = null;
        }
    }

    async sendOTP(phone, otp) {
        const message = `Your Wedding Butler OTP is: ${otp}. Valid for 5 minutes.`;

        if (!this.client) {
            console.log(`[SMS-SIMULATION] To: ${phone} | Msg: ${message}`);
            require('fs').appendFileSync('otp.log', `[SMS-SIMULATION] To: ${phone} | Msg: ${message}\n`);
            return { success: true, simulated: true };
        }

        try {
            await this.client.messages.create({
                body: message,
                from: this.from,
                to: phone
            });
            console.log(`[SMS] OTP sent successfully to ${phone}`);
            return { success: true };
        } catch (error) {
            console.error(`[SMS] Failed to send SMS to ${phone}:`, error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new SMSService();
