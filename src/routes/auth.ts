import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { db } from '../db';
import { notifyService } from '../services/notify';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per `window` (here, per 15 minutes)
  message: { error: 'Too many OTP requests from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper to generate 6-digit OTP securely
const generateOTP = () => crypto.randomInt(100000, 999999).toString();

// Helper to send email OTP
const sendOTPEmail = async (email: string, otp: string) => {
  const subject = 'LiForce - Your Verification Code';
  const html = `<h2>Your Verification Code</h2>
                <p>Your one-time password is: <strong>${otp}</strong></p>
                <p>This code will expire in 5 minutes.</p>`;
  await notifyService.sendEmail(email, subject, html);
};

// Helper for JWT cookie setting
const setTokenCookie = (res: any, token: string) => {
  res.cookie('liforce_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
};

// ==========================================
// REGISTRATION FLOW
// ==========================================

router.post('/register/initiate', otpLimiter, async (req, res) => {
  try {
    const { email, userType } = req.body;

    if (!email || !userType) {
      return res.status(400).json({ error: 'Email and userType are required' });
    }

    // Check if user already exists
    if (userType === 'donor') {
      const existing = await db.user.findUnique({ where: { email } });
      if (existing) return res.status(400).json({ error: 'Email already exists' });
    } else if (userType === 'bloodbank') {
      const existing = await db.bloodBank.findUnique({ where: { email } });
      if (existing) return res.status(400).json({ error: 'Email already exists' });
    } else {
      return res.status(400).json({ error: 'Unsupported userType' });
    }

    // Cooldown check (60s)
    const recentOtp = await db.otp.findFirst({
      where: { email, type: 'REGISTER', userType },
      orderBy: { createdAt: 'desc' }
    });

    if (recentOtp && (Date.now() - recentOtp.createdAt.getTime() < 60000)) {
      return res.status(429).json({ error: 'Please wait 60 seconds before requesting another OTP' });
    }

    // Delete previous OTPs for this email to ensure only one active OTP
    await db.otp.deleteMany({
      where: { email, type: 'REGISTER', userType }
    });

    // Generate and save OTP
    const otp = generateOTP();
    const hashedOtp = await bcrypt.hash(otp, 10);
    
    await db.otp.create({
      data: {
        email,
        code: hashedOtp,
        type: 'REGISTER',
        userType,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 mins
      }
    });

    // Do not await the email so the frontend doesn't hang if SMTP times out
    sendOTPEmail(email, otp).catch(console.error);
    return res.status(200).json({ 
      message: 'OTP sent to email',
      devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined 
    });
  } catch (error) {
    console.error('Registration initiate error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/register/verify', async (req, res) => {
  try {
    const { email, code, userType, password, name, bloodGroup, licenseNumber, phone, address, latitude, longitude, age, gender } = req.body;

    if (!email || !code || !userType || !password || !name) {
      return res.status(400).json({ error: 'Missing required registration parameters' });
    }

    // Get the most recent active OTP
    const otpRecord = await db.otp.findFirst({
      where: { email, type: 'REGISTER', userType },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord) return res.status(400).json({ error: 'Invalid or expired OTP' });
    
    // Check expiry
    if (otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ error: 'OTP has expired' });
    }

    // Compare Hash
    const isMatch = await bcrypt.compare(code, otpRecord.code);
    if (!isMatch) return res.status(400).json({ error: 'Invalid OTP' });

    // OTP is valid. Create the actual user
    const hash = await bcrypt.hash(password, 10);
    let userId = "";

    if (userType === 'donor') {
      const user = await db.user.create({
        data: { 
          name, 
          email, 
          passwordHash: hash, 
          bloodGroup: bloodGroup || 'O+',
          age: age ? Number(age) : null,
          gender: gender || null,
          address: address || null,
          latitude: latitude ? Number(latitude) : null,
          longitude: longitude ? Number(longitude) : null,
          isVerified: true // Auto-verify seeded/created donors for easy local flow
        }
      });
      userId = user.id;
    } else if (userType === 'bloodbank') {
      const bb = await db.bloodBank.create({
        data: { 
          name, 
          email, 
          passwordHash: hash, 
          licenseNumber: licenseNumber || `LIC-${Date.now()}`, 
          phone: phone || '0000000000', 
          address: address || 'Default Address',
          latitude: latitude ? Number(latitude) : null,
          longitude: longitude ? Number(longitude) : null,
          isVerified: true // Auto-verify bloodbanks for local demo
        }
      });
      userId = bb.id;
    }

    // Delete used OTP
    await db.otp.deleteMany({ where: { email, type: 'REGISTER', userType } });

    // Generate JWT and set Cookie
    const token = jwt.sign({ id: userId, role: userType }, JWT_SECRET, { expiresIn: '7d' });
    setTokenCookie(res, token);
    
    return res.status(201).json({ 
      message: 'Registration successful', 
      token, 
      user: { id: userId, name, email } 
    });
  } catch (error) {
    console.error('Registration verify error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==========================================
// LOGIN FLOW
// ==========================================

router.post('/login/initiate', otpLimiter, async (req, res) => {
  try {
    const { email, password, userType } = req.body;

    if (!email || !password || !userType) {
      return res.status(400).json({ error: 'Email, password, and userType are required' });
    }

    let userHash = "";
    if (userType === 'donor') {
      const user = await db.user.findUnique({ where: { email } });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      userHash = user.passwordHash;
    } else if (userType === 'bloodbank') {
      const bb = await db.bloodBank.findUnique({ where: { email } });
      if (!bb) return res.status(401).json({ error: 'Invalid credentials' });
      userHash = bb.passwordHash;
    } else {
      return res.status(400).json({ error: 'Unsupported userType' });
    }

    const isMatch = await bcrypt.compare(password, userHash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    // Cooldown check (60s)
    const recentOtp = await db.otp.findFirst({
      where: { email, type: 'LOGIN', userType },
      orderBy: { createdAt: 'desc' }
    });

    if (recentOtp && (Date.now() - recentOtp.createdAt.getTime() < 60000)) {
      return res.status(429).json({ error: 'Please wait 60 seconds before requesting another OTP' });
    }

    // Delete previous OTPs
    await db.otp.deleteMany({
      where: { email, type: 'LOGIN', userType }
    });

    // Generate and save OTP
    const otp = generateOTP();
    const hashedOtp = await bcrypt.hash(otp, 10);

    await db.otp.create({
      data: {
        email,
        code: hashedOtp,
        type: 'LOGIN',
        userType,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      }
    });

    // Do not await the email so the frontend doesn't hang if SMTP times out
    sendOTPEmail(email, otp).catch(console.error);
    return res.status(200).json({ 
      message: 'OTP sent to email',
      devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined 
    });
  } catch (error) {
    console.error('Login initiate error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/login/verify', async (req, res) => {
  try {
    const { email, code, userType } = req.body;

    if (!email || !code || !userType) {
      return res.status(400).json({ error: 'Email, code, and userType are required' });
    }

    // Get OTP
    const otpRecord = await db.otp.findFirst({
      where: { email, type: 'LOGIN', userType },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord) return res.status(400).json({ error: 'Invalid or expired OTP' });
    
    if (otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ error: 'OTP has expired' });
    }

    // Compare Hash
    const isMatch = await bcrypt.compare(code, otpRecord.code);
    if (!isMatch) return res.status(400).json({ error: 'Invalid OTP' });

    // Success. Get user details for payload
    let userId = "";
    let userName = "";
    if (userType === 'donor') {
      const user = await db.user.findUnique({ where: { email } });
      userId = user!.id;
      userName = user!.name;
    } else {
      const bb = await db.bloodBank.findUnique({ where: { email } });
      userId = bb!.id;
      userName = bb!.name;
    }

    // Delete used OTP
    await db.otp.deleteMany({ where: { email, type: 'LOGIN', userType } });

    // Generate JWT and set Cookie
    const token = jwt.sign({ id: userId, role: userType }, JWT_SECRET, { expiresIn: '7d' });
    setTokenCookie(res, token);

    return res.status(200).json({ token, user: { id: userId, name: userName, email } });
  } catch (error) {
    console.error('Login verify error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==========================================
// LOGOUT FLOW
// ==========================================
router.post('/logout', (req, res) => {
  res.clearCookie('liforce_token');
  res.status(200).json({ message: 'Logged out successfully' });
});

// ==========================================
// FORGOT PASSWORD FLOW
// ==========================================
router.post('/forgot-password/initiate', otpLimiter, async (req, res) => {
  try {
    const { email, userType } = req.body;
    if (!email || !userType) return res.status(400).json({ error: 'Email and userType are required' });

    let existing;
    if (userType === 'donor') existing = await db.user.findUnique({ where: { email } });
    else if (userType === 'bloodbank') existing = await db.bloodBank.findUnique({ where: { email } });
    else return res.status(400).json({ error: 'Unsupported userType' });

    if (!existing) return res.status(404).json({ error: 'Account not found' });

    const recentOtp = await db.otp.findFirst({
      where: { email, type: 'RESET', userType },
      orderBy: { createdAt: 'desc' }
    });

    if (recentOtp && (Date.now() - recentOtp.createdAt.getTime() < 60000)) {
      return res.status(429).json({ error: 'Please wait 60 seconds before requesting another OTP' });
    }

    await db.otp.deleteMany({ where: { email, type: 'RESET', userType } });

    const otp = generateOTP();
    const hashedOtp = await bcrypt.hash(otp, 10);
    
    await db.otp.create({
      data: {
        email,
        code: hashedOtp,
        type: 'RESET',
        userType,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      }
    });

    // Do not await the email so the frontend doesn't hang if SMTP times out
    sendOTPEmail(email, otp).catch(console.error);
    return res.status(200).json({ message: 'OTP sent to email' });
  } catch (error) {
    console.error('Forgot password initiate error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/forgot-password/verify', async (req, res) => {
  try {
    const { email, code, newPassword, userType } = req.body;
    if (!email || !code || !newPassword || !userType) return res.status(400).json({ error: 'Missing required fields' });

    const otpRecord = await db.otp.findFirst({
      where: { email, type: 'RESET', userType },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord) return res.status(400).json({ error: 'Invalid or expired OTP' });
    if (otpRecord.expiresAt < new Date()) return res.status(400).json({ error: 'OTP has expired' });

    const isMatch = await bcrypt.compare(code, otpRecord.code);
    if (!isMatch) return res.status(400).json({ error: 'Invalid OTP' });

    const newHash = await bcrypt.hash(newPassword, 10);

    if (userType === 'donor') {
      await db.user.update({ where: { email }, data: { passwordHash: newHash } });
    } else if (userType === 'bloodbank') {
      await db.bloodBank.update({ where: { email }, data: { passwordHash: newHash } });
    }

    await db.otp.deleteMany({ where: { email, type: 'RESET', userType } });

    return res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Forgot password verify error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ==========================================
// SETTINGS UPDATE FLOW
// ==========================================
router.post('/settings/initiate', requireAuth, otpLimiter, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    
    if (!userId || !userRole) return res.status(401).json({ error: 'Unauthorized' });

    let email = '';
    if (userRole === 'donor') {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (user) email = user.email;
    } else if (userRole === 'bloodbank') {
      const bank = await db.bloodBank.findUnique({ where: { id: userId } });
      if (bank) email = bank.email;
    }

    if (!email) return res.status(404).json({ error: 'Account not found' });

    const recentOtp = await db.otp.findFirst({
      where: { email, type: 'SETTINGS', userType: userRole },
      orderBy: { createdAt: 'desc' }
    });

    if (recentOtp && (Date.now() - recentOtp.createdAt.getTime() < 60000)) {
      return res.status(429).json({ error: 'Please wait 60 seconds before requesting another OTP' });
    }

    await db.otp.deleteMany({ where: { email, type: 'SETTINGS', userType: userRole } });

    const otp = generateOTP();
    const hashedOtp = await bcrypt.hash(otp, 10);
    
    await db.otp.create({
      data: {
        email,
        code: hashedOtp,
        type: 'SETTINGS',
        userType: userRole,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      }
    });

    // Do not await the email so the frontend doesn't hang if SMTP times out
    sendOTPEmail(email, otp).catch(console.error);
    return res.status(200).json({ message: 'OTP sent to current email' });
  } catch (error) {
    console.error('Settings initiate error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/settings/verify', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { code, newEmail, newPassword, newPhone, newLatitude, newLongitude } = req.body;
    
    if (!userId || !userRole || !code) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let currentEmail = '';
    if (userRole === 'donor') {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (user) currentEmail = user.email;
    } else if (userRole === 'bloodbank') {
      const bank = await db.bloodBank.findUnique({ where: { id: userId } });
      if (bank) currentEmail = bank.email;
    }

    if (!currentEmail) return res.status(404).json({ error: 'Account not found' });

    const otpRecord = await db.otp.findFirst({
      where: { email: currentEmail, type: 'SETTINGS', userType: userRole },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord) return res.status(400).json({ error: 'Invalid or expired OTP' });
    if (otpRecord.expiresAt < new Date()) return res.status(400).json({ error: 'OTP has expired' });

    const isMatch = await bcrypt.compare(code, otpRecord.code);
    if (!isMatch) return res.status(400).json({ error: 'Invalid OTP' });

    const updateData: any = {};
    if (newEmail) updateData.email = newEmail;
    if (newPhone) updateData.phone = newPhone;
    if (newLatitude) updateData.latitude = newLatitude;
    if (newLongitude) updateData.longitude = newLongitude;
    if (newPassword) updateData.passwordHash = await bcrypt.hash(newPassword, 10);

    if (Object.keys(updateData).length > 0) {
      if (userRole === 'donor') {
        await db.user.update({ where: { id: userId }, data: updateData });
      } else if (userRole === 'bloodbank') {
        await db.bloodBank.update({ where: { id: userId }, data: updateData });
      }
    }

    await db.otp.deleteMany({ where: { email: currentEmail, type: 'SETTINGS', userType: userRole } });

    return res.status(200).json({ message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Settings verify error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
