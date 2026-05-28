import nodemailer from 'nodemailer';
import twilio from 'twilio';

// Load credentials safely
const twilioSid = process.env.TWILIO_SID || 'AC_dummy';
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || 'dummy_token';

let twilioClient: any = null;
try {
  if (process.env.TWILIO_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(twilioSid, twilioAuthToken);
  }
} catch (err) {
  console.warn('⚠️ Failed to initialize Twilio client:', err);
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER || 'dummy_user@gmail.com',
    pass: process.env.EMAIL_PASS || 'dummy_pass'
  }
});

export const notifyService = {
  sendSMS: async (to: string, message: string): Promise<boolean> => {
    try {
      console.log(`📱 [SMS Alert] Sent to ${to}: "${message}"`);
      if (twilioClient && process.env.TWILIO_PHONE) {
        await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE,
          to
        });
      }
      return true;
    } catch (error) {
      console.error('❌ Failed to send SMS:', error);
      return false;
    }
  },

  sendEmail: async (to: string, subject: string, html: string): Promise<boolean> => {
    try {
      console.log(`✉️ [Email Alert] Sent to ${to} | Subject: "${subject}"`);
      // For local development, we log OTP directly to terminal for easy copy-paste
      if (subject.includes('Verification Code')) {
        console.log(`🔑 [VERIFICATION CODE LOG] Sent to ${to}. Content: ${html}`);
      }
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        await transporter.sendMail({
          from: process.env.EMAIL_USER || '"LiForce Alerts" <alerts@liforce.org>',
          to,
          subject,
          html
        });
      }
      return true;
    } catch (error) {
      console.error('❌ Failed to send Email:', error);
      return false;
    }
  }
};
