import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { notifyService } from '../services/notify';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

// Helper to generate 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Helper to send email OTP
const sendOTPEmail = async (email: string, otp: string) => {
  const subject = 'LiForce - Your Verification Code';
  const html = `<h2>Your Verification Code</h2>
                <p>Your one-time password is: <strong>${otp}</strong></p>
                <p>This code will expire in 10 minutes.</p>`;
  await notifyService.sendEmail(email, subject, html);
};

// ==========================================
// REGISTRATION FLOW
// ==========================================

router.post('/register/initiate', async (req, res) => {
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

    // Generate and save OTP
    const otp = generateOTP();
    await db.otp.create({
      data: {
        email,
        code: otp,
        type: 'REGISTER',
        userType,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 mins
      }
    });

    await sendOTPEmail(email, otp);
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

    // Verify OTP
    const otpRecord = await db.otp.findFirst({
      where: { email, code, type: 'REGISTER', userType },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord) return res.status(400).json({ error: 'Invalid OTP' });
    if (otpRecord.expiresAt < new Date()) return res.status(400).json({ error: 'OTP has expired' });

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
    await db.otp.delete({ where: { id: otpRecord.id } });

    // Generate JWT
    const token = jwt.sign({ id: userId, role: userType }, JWT_SECRET, { expiresIn: '7d' });
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

router.post('/login/initiate', async (req, res) => {
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

    // Generate and save OTP
    const otp = generateOTP();
    await db.otp.create({
      data: {
        email,
        code: otp,
        type: 'LOGIN',
        userType,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    await sendOTPEmail(email, otp);
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

    // Verify OTP
    const otpRecord = await db.otp.findFirst({
      where: { email, code, type: 'LOGIN', userType },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord) return res.status(400).json({ error: 'Invalid OTP' });
    if (otpRecord.expiresAt < new Date()) return res.status(400).json({ error: 'OTP has expired' });

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
    await db.otp.delete({ where: { id: otpRecord.id } });

    // Generate JWT
    const token = jwt.sign({ id: userId, role: userType }, JWT_SECRET, { expiresIn: '7d' });
    return res.status(200).json({ token, user: { id: userId, name: userName, email } });
  } catch (error) {
    console.error('Login verify error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
