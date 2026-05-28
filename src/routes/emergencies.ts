import { Router, Request, Response } from 'express';
import { db } from '../db';
import { notifyMatchedDonors, notifyEmergencyResponse } from '../services/websocket';
import { notifyService } from '../services/notify';
import { requireAuth, AuthRequest } from '../middleware/auth';
import jwt from 'jsonwebtoken';

const router = Router();

// Helper function to calculate distance using Haversine formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// POST: Match emergency request to nearby eligible donors
router.post('/match/emergency', async (req: Request, res: Response) => {
  try {
    const { bloodGroup, latitude, longitude, radiusKm = 10, donorRadiusKm = 50, bankRadiusKm = 200 } = req.body;

    if (!latitude || !longitude || !bloodGroup) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Step 1: Find all verified donors with matching blood type who haven't donated in 56 days
    const fiftySixDaysAgo = new Date();
    fiftySixDaysAgo.setDate(fiftySixDaysAgo.getDate() - 56);

    let requesterId = null;
    let token = req.cookies?.liforce_token;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }
    
    if (token) {
      try {
        const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';
        const payload = jwt.verify(token, JWT_SECRET) as { id: string };
        requesterId = payload.id;
      } catch (e) {}
    }

    const candidates = await db.user.findMany({
      where: {
        bloodGroup,
        isVerified: true,
        ...(requesterId && { id: { not: requesterId } }),
        latitude: { not: null },
        longitude: { not: null },
        OR: [
          { lastDonatedAt: null },
          { lastDonatedAt: { lte: fiftySixDaysAgo } }
        ]
      },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        maxTravelDistanceKm: true,
        phone: true,
      }
    });

    // Step 2: Filter by Haversine distance for donors
    const matchedDonors = candidates.filter(donor => {
      const distance = calculateDistance(latitude, longitude, donor.latitude!, donor.longitude!);
      // Donor must be within the search radius AND the emergency must be within the donor's max travel distance
      return distance <= donorRadiusKm && distance <= donor.maxTravelDistanceKm;
    }).map(donor => ({
      ...donor,
      type: 'Donor',
      distanceKm: Number(calculateDistance(latitude, longitude, donor.latitude!, donor.longitude!).toFixed(2))
    }));

    // Step 3: Find Blood Banks with available inventory
    const bankCandidates = await db.bloodBank.findMany({
      where: {
        isVerified: true,
        ...(requesterId && { id: { not: requesterId } }),
        latitude: { not: null },
        longitude: { not: null },
        inventory: {
          some: {
            bloodGroup,
            unitsAvailable: { gt: 0 }
          }
        }
      },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        phone: true,
      }
    });

    // Step 4: Filter by Haversine distance for blood banks
    const matchedBanks = bankCandidates.filter(bank => {
      const distance = calculateDistance(latitude, longitude, bank.latitude!, bank.longitude!);
      return distance <= bankRadiusKm;
    }).map(bank => ({
      ...bank,
      type: 'BloodBank',
      distanceKm: Number(calculateDistance(latitude, longitude, bank.latitude!, bank.longitude!).toFixed(2))
    }));

    // Combine and sort
    const allMatches = [...matchedDonors, ...matchedBanks].sort((a, b) => a.distanceKm - b.distanceKm);

    return res.json({
      matchCount: allMatches.length,
      donors: allMatches
    });

  } catch (error) {
    console.error('Geospatial matching error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Create a new emergency request
router.post('/emergencies', async (req: Request, res: Response) => {
  try {
    const { 
      patientName, 
      bloodGroup, 
      unitsRequired, 
      hospitalAddress, 
      contactNumber, 
      urgencyLevel, 
      requesterId, 
      latitude, 
      longitude,
      patientGender,
      patientAge,
      deliveryMode,
      requiredDate,
      deliveryAddress,
      assignedBloodBankId
    } = req.body;

    if (!patientName || !bloodGroup || !hospitalAddress) {
      return res.status(400).json({ error: 'Patient name, blood group, and hospital name are required' });
    }

    // Since requesterId is a required relation key in the database schema,
    // if it is not provided, we will look up the first seeded user and assign it.
    let finalRequesterId = requesterId;

    // Check if Authorization header is present
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';
        const payload = jwt.verify(token, JWT_SECRET) as { id: string; role: string };
        finalRequesterId = payload.id;
      } catch (err) {
        console.warn('Failed to verify token in emergency creation, using request body/fallback', err);
      }
    }

    if (!finalRequesterId) {
      const firstUser = await db.user.findFirst();
      if (firstUser) {
        finalRequesterId = firstUser.id;
      } else {
        // Absolute fallback if no user exists at all
        return res.status(400).json({ error: 'No user registered to assign this request to' });
      }
    }

    const emergency = await db.emergencyRequest.create({
      data: {
        patientName,
        patientGender: patientGender || null,
        patientAge: patientAge ? parseInt(patientAge) : null,
        bloodGroup,
        unitsRequired: parseInt(unitsRequired) || 1,
        hospitalAddress: hospitalAddress, // Stored as hospitalAddress based on new schema
        urgency: urgencyLevel || 'Normal',
        latitude: Number(latitude) || 30.7333,
        longitude: Number(longitude) || 76.7794,
        status: 'Active',
        requesterId: finalRequesterId,
        requiredDate: requiredDate ? new Date(requiredDate) : null,
        assignedBloodBankId: assignedBloodBankId || null
      }
    });

    // Calculate matched donors using standard Haversine formula
    const fiftySixDaysAgo = new Date();
    fiftySixDaysAgo.setDate(fiftySixDaysAgo.getDate() - 56);

    const candidates = await db.user.findMany({
      where: {
        bloodGroup,
        isVerified: true,
        latitude: { not: null },
        longitude: { not: null },
        id: { not: finalRequesterId },
        OR: [
          { lastDonatedAt: null },
          { lastDonatedAt: { lte: fiftySixDaysAgo } }
        ]
      }
    });

    const radiusKm = 15; // default search radius
    const matchedDonors = candidates.filter(donor => {
      const distance = calculateDistance(emergency.latitude, emergency.longitude, donor.latitude!, donor.longitude!);
      return distance <= radiusKm && distance <= donor.maxTravelDistanceKm;
    });

    // Prepare real-time SOS payload
    const alertData = {
      id: emergency.id,
      patientName: emergency.patientName,
      patientGender: emergency.patientGender,
      patientAge: emergency.patientAge,
      bloodGroup: emergency.bloodGroup,
      unitsRequired: emergency.unitsRequired,
      hospitalAddress: emergency.hospitalAddress,
      urgency: emergency.urgency,
      latitude: emergency.latitude,
      longitude: emergency.longitude,
      contactNumber: contactNumber || 'Not specified',
      requesterId: finalRequesterId
    };

    // 1. Dispatch real-time WebSocket alerts to all matched donors
    notifyMatchedDonors(matchedDonors, alertData);

    // 2. Dispatch SMS alert logs
    matchedDonors.forEach((donor) => {
      if (donor.phone) {
        const msg = `CRITICAL SOS: Urgent ${emergency.bloodGroup} needed at ${emergency.hospitalAddress} for ${emergency.patientName}. Respond immediately on LiForce!`;
        notifyService.sendSMS(donor.phone, msg);
      }
    });

    return res.status(201).json(emergency);
  } catch (error) {
    console.error('Create emergency error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET: Fetch emergency requests for the homepage banner (role based filtering)
router.get('/emergencies/banner', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    let userId: string | null = null;
    let role: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';
        const payload = jwt.verify(token, JWT_SECRET) as { id: string; role: string };
        userId = payload.id;
        role = payload.role;
      } catch (err) {
        console.warn('Failed to verify token in banner endpoint');
      }
    }

    const emergencies = await db.emergencyRequest.findMany({
      where: { 
        status: 'Active',
        ...(userId && { requesterId: { not: userId } }) // don't show user their own request
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!userId) {
      // If not logged in, return all active emergencies
      return res.json(emergencies.slice(0, 10));
    }

    // Authenticated flow
    if (role === 'donor') {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user || !user.latitude || !user.longitude) return res.json(emergencies.slice(0, 10));
      
      const radius = 50; // 50km for donors
      const nearby = emergencies.filter(req => {
        if (!req.latitude || !req.longitude) return false;
        const dist = calculateDistance(user.latitude!, user.longitude!, req.latitude, req.longitude);
        return dist <= radius;
      });
      return res.json(nearby.slice(0, 10));
    } else if (role === 'bloodbank') {
      const bank = await db.bloodBank.findUnique({ where: { id: userId } });
      if (!bank || !bank.latitude || !bank.longitude) return res.json(emergencies.slice(0, 10));

      const radius = 200; // 200km for blood banks
      const nearby = emergencies.filter(req => {
        if (!req.latitude || !req.longitude) return false;
        const dist = calculateDistance(bank.latitude!, bank.longitude!, req.latitude, req.longitude);
        return dist <= radius;
      });
      return res.json(nearby.slice(0, 10));
    }

    return res.json(emergencies.slice(0, 10));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET: Fetch my active emergency request with its responders
router.get('/emergencies/my-active', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const activeRequest = await db.emergencyRequest.findFirst({
      where: {
        requesterId: userId,
        status: 'Active'
      },
      include: {
        responses: {
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });
    return res.json(activeRequest || null);
  } catch (error) {
    console.error('Fetch active request error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Respond to an emergency request
router.post('/emergencies/:id/respond', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      responderId,
      bloodBankId,
      responderName,
      responderPhone,
      responderType,
      responseType,
      bloodGroup
    } = req.body;

    if (!responderName || !responderType || !responseType || !bloodGroup) {
      return res.status(400).json({ error: 'Responder name, type, response type, and blood group are required' });
    }

    // 56-day cooldown enforcement for self-donation responses
    if (responseType === 'I will donate myself' && responderId && responderType === 'Donor') {
      const donorRecord = await db.user.findUnique({
        where: { id: responderId },
        select: { lastDonatedAt: true }
      });
      if (donorRecord?.lastDonatedAt) {
        const COOLDOWN_DAYS = 56;
        const lastDate = new Date(donorRecord.lastDonatedAt);
        const eligibleDate = new Date(lastDate);
        eligibleDate.setDate(eligibleDate.getDate() + COOLDOWN_DAYS);
        const today = new Date();
        const diffTime = eligibleDate.getTime() - today.getTime();
        const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (daysRemaining > 0) {
          return res.status(400).json({
            error: `Cooldown active. You can donate again in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
            daysRemaining,
            eligibleDate: eligibleDate.toISOString()
          });
        }
      }
    }

    const emergency = await db.emergencyRequest.findUnique({
      where: { id }
    });

    if (!emergency) {
      return res.status(404).json({ error: 'Emergency request not found' });
    }

    const newResponse = await db.emergencyResponse.create({
      data: {
        emergencyId: id,
        responderId: responderId || null,
        bloodBankId: bloodBankId || null,
        responderName,
        responderPhone: responderPhone || null,
        responderType,
        responseType,
        bloodGroup
      }
    });

    // Update the EmergencyRequest to assign the responding bank or donor
    const assignedId = responderType === 'BloodBank' ? bloodBankId : responderId;
    if (assignedId) {
      await db.emergencyRequest.update({
        where: { id },
        data: { assignedBloodBankId: assignedId }
      });
    }

    // Notify the creator of the emergency request via WebSockets in real time
    notifyEmergencyResponse(emergency.requesterId, {
      ...newResponse,
      patientName: emergency.patientName,
      hospitalAddress: emergency.hospitalAddress
    });

    return res.status(201).json(newResponse);
  } catch (error) {
    console.error('Respond to emergency error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});


// PUT: Update emergency request status (Fulfill or Cancel)
router.put('/emergencies/:id/status', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user!.id;

    if (!['Active', 'Fulfilled', 'Cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const emergency = await db.emergencyRequest.findUnique({
      where: { id }
    });

    if (!emergency) {
      return res.status(404).json({ error: 'Emergency request not found' });
    }

    // Verify ownership (requester or assigned blood bank)
    if (emergency.requesterId !== userId && emergency.assignedBloodBankId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You are not authorized to update this request' });
    }

    const updated = await db.emergencyRequest.update({
      where: { id },
      data: { status }
    });

    // Award points to both parties when fulfilled
    if (status === 'Fulfilled') {
      await db.user.update({
        where: { id: emergency.requesterId },
        data: { rewardPoints: { increment: 100 } }
      });

      if (emergency.assignedBloodBankId) {
        await db.bloodBank.update({
          where: { id: emergency.assignedBloodBankId },
          data: { rewardPoints: { increment: 100 } }
        });
      }
    }

    // Deduct inventory automatically if a Blood Bank is marking it as Fulfilled
    if (status === 'Fulfilled' && emergency.assignedBloodBankId === userId) {
      const inventory = await db.inventory.findUnique({
        where: {
          bloodBankId_bloodGroup: {
            bloodBankId: userId,
            bloodGroup: emergency.bloodGroup
          }
        }
      });

      if (inventory) {
        const newUnits = Math.max(0, inventory.unitsAvailable - emergency.unitsRequired);
        let newStatus: 'Critical' | 'Low' | 'Good' = 'Good';
        if (newUnits < 5) newStatus = 'Critical';
        else if (newUnits < 15) newStatus = 'Low';

        await db.inventory.update({
          where: {
            bloodBankId_bloodGroup: {
              bloodBankId: userId,
              bloodGroup: emergency.bloodGroup
            }
          },
          data: {
            unitsAvailable: newUnits,
            status: newStatus
          }
        });
      }
    }

    return res.json(updated);
  } catch (error) {
    console.error('Update status error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
