import { Router, Response } from 'express';
import { db } from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// Get donor profile
router.get('/donors/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        bloodGroup: true,
        phone: true,
        city: true,
        lastDonatedAt: true,
        rewardPoints: true,
        isVerified: true,
        maxTravelDistanceKm: true,
        notificationsEnabled: true,
        latitude: true,
        longitude: true,
        age: true,
        gender: true,
        createdAt: true,
        donations: {
          include: {
            bloodBank: {
              select: { 
                name: true,
                address: true,
                phone: true
              }
            }
          },
          orderBy: { scheduledDate: 'desc' }
        },
      }
    });

    if (!user) return res.status(404).json({ error: 'Donor not found' });

    // Fetch upcoming camps user has RSVP'd to
    const rsvps = await db.campRSVP.findMany({ where: { userId } });
    const campIds = rsvps.map((r: any) => r.campId);
    
    // Only get camps that are today or in the future
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const upcomingCamps = await db.camp.findMany({
      where: { 
        id: { in: campIds },
        date: { gte: startOfToday }
      },
      orderBy: { date: 'asc' }
    });

    return res.json({ ...user, upcomingCamps });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get all verified donors for the map
router.get('/donors', async (req, res) => {
  try {
    const donors = await db.user.findMany({
      where: { 
        isVerified: true,
        latitude: { not: null },
        longitude: { not: null }
      },
      select: {
        id: true,
        name: true,
        bloodGroup: true,
        latitude: true,
        longitude: true,
        city: true,
        lastDonatedAt: true,
        maxTravelDistanceKm: true,
      }
    });

    const fiftySixDaysAgo = new Date();
    fiftySixDaysAgo.setDate(fiftySixDaysAgo.getDate() - 56);

    const formattedDonors = donors.map(d => ({
      ...d,
      status: (!d.lastDonatedAt || d.lastDonatedAt <= fiftySixDaysAgo) ? 'Good' : 'Critical'
    }));

    return res.json(formattedDonors);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update donor profile
router.put('/donors/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { phone, city, maxTravelDistanceKm, notificationsEnabled, latitude, longitude } = req.body;

    const updated = await db.user.update({
      where: { id: userId },
      data: {
        ...(phone && { phone }),
        ...(city && { city }),
        ...(maxTravelDistanceKm && { maxTravelDistanceKm: Number(maxTravelDistanceKm) }),
        ...(notificationsEnabled !== undefined && { notificationsEnabled }),
        ...(latitude && { latitude: Number(latitude) }),
        ...(longitude && { longitude: Number(longitude) }),
      },
      select: {
        id: true,
        name: true,
        phone: true,
        city: true,
        maxTravelDistanceKm: true,
      }
    });

    return res.json({ message: 'Profile updated successfully', user: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

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

// Get nearby emergency requests
router.get('/donors/emergencies/nearby', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const user = await db.user.findUnique({ 
      where: { id: userId }, 
      select: { latitude: true, longitude: true, maxTravelDistanceKm: true }
    });
    
    if (!user || !user.latitude || !user.longitude) {
      // Return latest emergencies as fallback
      const fallback = await db.emergencyRequest.findMany({
        where: { 
          status: 'Active',
          requesterId: { not: userId }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      });
      return res.json(fallback);
    }

    const emergencies = await db.emergencyRequest.findMany({
      where: { 
        status: 'Active',
        requesterId: { not: userId }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    // Filter by max travel distance
    const nearbyEmergencies = emergencies.filter(req => {
      if (!req.latitude || !req.longitude) return false;
      const dist = calculateDistance(user.latitude!, user.longitude!, req.latitude, req.longitude);
      return dist <= user.maxTravelDistanceKm;
    });
    
    return res.json(nearbyEmergencies.slice(0, 10));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get Leaderboard
router.get('/donors/leaderboard', async (req, res) => {
  try {
    const topDonors = await db.user.findMany({
      where: { isVerified: true },
      orderBy: { rewardPoints: 'desc' },
      take: 20,
      select: {
        id: true,
        name: true,
        bloodGroup: true,
        rewardPoints: true,
        city: true,
        donations: {
          where: { status: 'Completed' }
        }
      }
    });
    
    const formatted = topDonors.map(donor => ({
      id: donor.id,
      name: donor.name,
      bloodGroup: donor.bloodGroup,
      rewardPoints: donor.rewardPoints,
      city: donor.city,
      _count: {
        donations: donor.donations.length
      }
    }));

    return res.json(formatted);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Community Routes
router.get('/community/posts', async (req, res) => {
  try {
    const posts = await db.post.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    return res.json(posts);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST: Submit a new story/post to the Gratitude Wall
router.post('/community/posts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role; // 'donor' or 'bloodbank'
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Story content cannot be empty.' });
    }
    if (content.trim().length < 130) {
      return res.status(400).json({ error: 'Story content must be at least 130 characters.' });
    }
    if (content.trim().length > 150) {
      return res.status(400).json({ error: 'Story content must be 150 characters or less.' });
    }

    let authorName = 'Anonymous';
    let authorInitials = 'A';

    if (userRole === 'donor') {
      const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
      if (user) {
        authorName = user.name;
        authorInitials = user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
      }
    } else if (userRole === 'bloodbank') {
      const bank = await db.bloodBank.findUnique({ where: { id: userId }, select: { name: true } });
      if (bank) {
        authorName = bank.name;
        authorInitials = bank.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
      }
    }

    const post = await db.post.create({
      data: {
        authorId: userId,
        authorType: userRole === 'bloodbank' ? 'bloodbank' : 'donor',
        content: content.trim(),
        authorName,
        authorInitials,
        likes: 0
      }
    });

    return res.status(201).json(post);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});


router.get('/community/camps', async (req, res) => {
  try {
    const camps = await db.camp.findMany({
      orderBy: { date: 'asc' },
      take: 10
    });
    return res.json(camps);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get Public Donor Profile
router.get('/donors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        bloodGroup: true,
        city: true,
        rewardPoints: true,
        lastDonatedAt: true,
        createdAt: true,
        age: true,
        gender: true,
        donations: {
          include: {
            bloodBank: {
              select: {
                name: true,
                address: true,
                phone: true
              }
            }
          },
          orderBy: { scheduledDate: 'desc' }
        }
      }
    });

    if (!user) return res.status(404).json({ error: 'Donor not found' });

    return res.json(user);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
