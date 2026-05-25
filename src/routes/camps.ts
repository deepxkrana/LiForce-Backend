import { Router, Response } from 'express';
import { db } from '../db';
import { requireAuth, requireBloodBank, AuthRequest } from '../middleware/auth';
import { getWebSocketIO } from '../services/websocket';

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

const router = Router();

// Protected: Organise a blood camp (Blood Bank only)
router.post('/camps/create', requireAuth, requireBloodBank, async (req: AuthRequest, res: Response) => {
  try {
    const bloodBankId = req.user!.id;
    const { title, date, location, description, capacity, maxDonorVolunteers, maxBloodBankVolunteers } = req.body;

    if (!title || !date || !location) {
      return res.status(400).json({ error: 'Missing required parameters: title, date, and location' });
    }

    // Fetch the blood bank to get name and coordinates
    const bloodBank = await db.bloodBank.findUnique({
      where: { id: bloodBankId },
      select: { name: true, latitude: true, longitude: true }
    });

    if (!bloodBank) {
      return res.status(404).json({ error: 'Blood bank organizer not found' });
    }

    // Create the camp
    const camp = await db.camp.create({
      data: {
        organizerId: bloodBankId,
        title,
        date: new Date(date),
        location,
        description: description || null,
        organizerName: bloodBank.name,
        latitude: bloodBank.latitude,
        longitude: bloodBank.longitude,
        rsvps: 0,
        capacity: capacity ? parseInt(capacity, 10) : 50,
        maxDonorVolunteers: maxDonorVolunteers ? parseInt(maxDonorVolunteers, 10) : 10,
        maxBloodBankVolunteers: maxBloodBankVolunteers ? parseInt(maxBloodBankVolunteers, 10) : 5
      }
    });

    // Notify eligible donors and blood banks
    if (bloodBank.latitude && bloodBank.longitude) {
      const donors = await db.user.findMany({
        where: { isVerified: true, latitude: { not: null }, longitude: { not: null } },
        select: { id: true, latitude: true, longitude: true }
      });
      
      const eligibleDonorIds = donors.filter(d => 
        calculateDistance(bloodBank.latitude!, bloodBank.longitude!, d.latitude!, d.longitude!) <= 50
      ).map(d => d.id);

      const banks = await db.bloodBank.findMany({
        where: { isVerified: true, id: { not: bloodBankId }, latitude: { not: null }, longitude: { not: null } },
        select: { id: true, latitude: true, longitude: true }
      });

      const eligibleBankIds = banks.filter(b => 
        calculateDistance(bloodBank.latitude!, bloodBank.longitude!, b.latitude!, b.longitude!) <= 200
      ).map(b => b.id);

      const notificationsToCreate = [];
      for (const donorId of eligibleDonorIds) {
        notificationsToCreate.push({
          userId: donorId,
          userType: 'donor',
          title: 'Upcoming Camp Near You!',
          message: `${bloodBank.name} is organizing a blood donation camp at ${location} on ${new Date(date).toLocaleDateString()}. Register now to help save lives.`
        });
      }
      for (const bankId of eligibleBankIds) {
        notificationsToCreate.push({
          userId: bankId,
          userType: 'bloodbank',
          title: 'Upcoming Camp in Your Region',
          message: `${bloodBank.name} is organizing a blood donation camp at ${location}. You can join as a volunteer.`
        });
      }

      if (notificationsToCreate.length > 0) {
        await db.notification.createMany({ data: notificationsToCreate });
      }
    }

    // Broadcast WebSocket notification to all active clients (specifically active donors)
    try {
      const io = getWebSocketIO();
      io.emit('new_camp_organized', {
        id: camp.id,
        title: camp.title,
        date: camp.date,
        location: camp.location,
        description: camp.description,
        organizerName: camp.organizerName,
        capacity: camp.capacity
      });
      console.log(`📢 Real-time WebSocket: Camp organised by ${bloodBank.name}: ${title} (Capacity: ${camp.capacity})`);
    } catch (wsError) {
      console.error('⚠️ Failed to broadcast WebSocket alert for camp:', wsError);
    }

    return res.status(201).json({
      message: 'Blood camp organised successfully',
      camp
    });
  } catch (error) {
    console.error('Error organizing blood camp:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Edit a blood camp
router.put('/camps/:id', requireAuth, requireBloodBank, async (req: AuthRequest, res: Response) => {
  try {
    const bloodBankId = req.user!.id;
    const { id } = req.params;
    const { title, date, location, description, capacity, maxDonorVolunteers, maxBloodBankVolunteers } = req.body;

    const existingCamp = await db.camp.findUnique({ where: { id } });
    if (!existingCamp) {
      return res.status(404).json({ error: 'Camp not found' });
    }

    if (existingCamp.organizerId !== bloodBankId) {
      return res.status(403).json({ error: 'Not authorized to edit this camp' });
    }

    const updatedCamp = await db.camp.update({
      where: { id },
      data: {
        title: title || existingCamp.title,
        date: date ? new Date(date) : existingCamp.date,
        location: location || existingCamp.location,
        description: description !== undefined ? description : existingCamp.description,
        capacity: capacity ? parseInt(capacity, 10) : existingCamp.capacity,
        maxDonorVolunteers: maxDonorVolunteers ? parseInt(maxDonorVolunteers, 10) : existingCamp.maxDonorVolunteers,
        maxBloodBankVolunteers: maxBloodBankVolunteers ? parseInt(maxBloodBankVolunteers, 10) : existingCamp.maxBloodBankVolunteers,
      }
    });

    try {
      const io = getWebSocketIO();
      io.emit('camp_updated', {
        id: updatedCamp.id,
        title: updatedCamp.title,
        date: updatedCamp.date,
        location: updatedCamp.location,
        capacity: updatedCamp.capacity
      });
    } catch (wsError) {
      console.error('⚠️ Failed to broadcast WebSocket alert for camp update:', wsError);
    }

    return res.json({ message: 'Camp updated successfully', camp: updatedCamp });
  } catch (error) {
    console.error('Error updating blood camp:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Abandon/Delete a blood camp
router.delete('/camps/:id', requireAuth, requireBloodBank, async (req: AuthRequest, res: Response) => {
  try {
    const bloodBankId = req.user!.id;
    const { id } = req.params;
    const { reason } = req.body;

    const existingCamp = await db.camp.findUnique({ where: { id } });
    if (!existingCamp) {
      return res.status(404).json({ error: 'Camp not found' });
    }

    if (existingCamp.organizerId !== bloodBankId) {
      return res.status(403).json({ error: 'Not authorized to delete this camp' });
    }

    await db.camp.delete({ where: { id } });

    try {
      const io = getWebSocketIO();
      io.emit('camp_abandoned', {
        id: existingCamp.id,
        title: existingCamp.title,
        reason: reason || 'No reason provided.'
      });
    } catch (wsError) {
      console.error('⚠️ Failed to broadcast WebSocket alert for camp deletion:', wsError);
    }

    return res.json({ message: 'Camp deleted successfully' });
  } catch (error) {
    console.error('Error deleting blood camp:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Complete a blood camp
router.post('/camps/:id/complete', requireAuth, requireBloodBank, async (req: AuthRequest, res: Response) => {
  try {
    const bloodBankId = req.user!.id;
    const { id } = req.params;

    const existingCamp = await db.camp.findUnique({ where: { id } });
    if (!existingCamp) {
      return res.status(404).json({ error: 'Camp not found' });
    }

    if (existingCamp.organizerId !== bloodBankId) {
      return res.status(403).json({ error: 'Not authorized to complete this camp' });
    }

    await db.$transaction(async (tx) => {
      // 1. Insert into CompletedCamp
      await tx.completedCamp.create({
        data: {
          id: existingCamp.id, // optional: keep the same ID for ease of reference
          organizerId: existingCamp.organizerId,
          title: existingCamp.title,
          date: existingCamp.date,
          location: existingCamp.location,
          description: existingCamp.description,
          rsvps: existingCamp.rsvps,
          capacity: existingCamp.capacity,
          maxDonorVolunteers: existingCamp.maxDonorVolunteers,
          maxBloodBankVolunteers: existingCamp.maxBloodBankVolunteers,
          createdAt: existingCamp.createdAt,
          organizerName: existingCamp.organizerName,
          latitude: existingCamp.latitude,
          longitude: existingCamp.longitude,
          isCompleted: true,
          checkedInDonor: (existingCamp as any).checkedInDonor || [],
          checkedInVolunteer: (existingCamp as any).checkedInVolunteer || [],
          checkedInBloodBanks: (existingCamp as any).checkedInBloodBanks || [],
          medicalCheck: (existingCamp as any).medicalCheck || [],
          ActuallyDonated: (existingCamp as any).ActuallyDonated || []
        }
      });

      // 2. Delete from Camp
      await tx.camp.delete({ where: { id } });
    });

    try {
      const io = getWebSocketIO();
      io.emit('camp_abandoned', { // Reusing this event or add a new one
        id: existingCamp.id,
        title: existingCamp.title,
        reason: 'Camp Completed'
      });
    } catch (wsError) {
      console.error('⚠️ Failed to broadcast WebSocket alert for camp completion:', wsError);
    }

    return res.json({ message: 'Camp marked as completed' });
  } catch (error) {
    console.error('Error completing blood camp:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Get user's RSVP'd camp IDs
router.get('/camps/my-rsvps', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const rsvps = await db.campRSVP.findMany({
      where: { userId },
      select: { campId: true }
    });
    const campIds = rsvps.map(r => r.campId);
    return res.json({ rsvps: campIds });
  } catch (error) {
    console.error('Error fetching RSVPs:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Get attendees for a camp (Blood Bank only)
router.get('/camps/:id/attendees', requireAuth, requireBloodBank, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const bloodBankId = req.user!.id;

    // Verify ownership
    const camp = await db.camp.findUnique({ where: { id } });
    if (!camp) return res.status(404).json({ error: 'Camp not found' });
    if (camp.organizerId !== bloodBankId) {
      return res.status(403).json({ error: 'Not authorized to view attendees for this camp' });
    }

    // Fetch RSVPs
    const rsvps = await db.campRSVP.findMany({
      where: { campId: id }
    });

    const donorRsvps = rsvps.filter(r => r.userType === 'donor');
    const bankRsvps = rsvps.filter(r => r.userType === 'bloodbank');

    const donors = [];
    if (donorRsvps.length > 0) {
      const donorIds = donorRsvps.map(r => r.userId);
      const fetchedDonors = await db.user.findMany({
        where: { id: { in: donorIds } },
        select: { id: true, name: true, bloodGroup: true, email: true }
      });
      for (const d of fetchedDonors) {
        const rsvp = donorRsvps.find(r => r.userId === d.id);
        if (rsvp) donors.push({ ...d, role: rsvp.role, rsvpId: rsvp.id, joinedAt: rsvp.createdAt });
      }
    }

    const bloodBanks = [];
    if (bankRsvps.length > 0) {
      const bankIds = bankRsvps.map(r => r.userId);
      const fetchedBanks = await db.bloodBank.findMany({
        where: { id: { in: bankIds } },
        select: { id: true, name: true, email: true, address: true }
      });
      for (const b of fetchedBanks) {
        const rsvp = bankRsvps.find(r => r.userId === b.id);
        if (rsvp) bloodBanks.push({ ...b, role: rsvp.role, rsvpId: rsvp.id, joinedAt: rsvp.createdAt });
      }
    }

    return res.json({ 
      donors, 
      bloodBanks,
      progress: {
        checkedInDonor: (camp as any).checkedInDonor || [],
        checkedInVolunteer: (camp as any).checkedInVolunteer || [],
        checkedInBloodBanks: (camp as any).checkedInBloodBanks || [],
        medicalCheck: (camp as any).medicalCheck || [],
        ActuallyDonated: (camp as any).ActuallyDonated || []
      }
    });
  } catch (error) {
    console.error('Error fetching attendees:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Update attendee progress in a camp
router.post('/camps/:id/attendees/:userId/progress', requireAuth, requireBloodBank, async (req: AuthRequest, res: Response) => {
  try {
    const bloodBankId = req.user!.id;
    const { id, userId } = req.params;
    const { progress, role, userType } = req.body; // progress: { checkin, medical, donated }

    const camp = await db.camp.findUnique({ where: { id } });
    if (!camp) return res.status(404).json({ error: 'Camp not found' });
    if (camp.organizerId !== bloodBankId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    let checkinField = '';
    if (userType === 'bloodbank') checkinField = 'checkedInBloodBanks';
    else if (role === 'volunteer') checkinField = 'checkedInVolunteer';
    else checkinField = 'checkedInDonor';

    const updateArray = (currentArr: string[], value: boolean | undefined | null) => {
      let arr = [...currentArr];
      if (value === true) {
        if (!arr.includes(userId)) arr.push(userId);
      } else if (value === false) {
        arr = arr.filter(uId => uId !== userId);
      }
      return arr;
    };

    const wasDonated = ((camp as any).ActuallyDonated || []).includes(userId);
    const isDonatedNow = progress.donated === true;
    const shouldTriggerRewards = !wasDonated && isDonatedNow;

    await db.$transaction(async (tx) => {
      await tx.camp.update({
        where: { id },
        data: {
          [checkinField]: progress.checkin !== undefined ? updateArray(((camp as any)[checkinField] as string[]) || [], progress.checkin) : (camp as any)[checkinField] || [],
          medicalCheck: progress.medical !== undefined ? updateArray((camp as any).medicalCheck || [], progress.medical) : (camp as any).medicalCheck || [],
          ActuallyDonated: progress.donated !== undefined ? updateArray((camp as any).ActuallyDonated || [], progress.donated) : (camp as any).ActuallyDonated || []
        } as any
      });

      if (shouldTriggerRewards && userType === 'donor') {
        const donor = await tx.user.findUnique({ where: { id: userId } });
        if (donor) {
          await tx.user.update({
            where: { id: userId },
            data: {
              lastDonatedAt: new Date(),
              rewardPoints: { increment: 100 }
            }
          });

          await tx.bloodBank.update({
            where: { id: bloodBankId },
            data: { rewardPoints: { increment: 100 } }
          });

          await tx.inventory.upsert({
            where: {
              bloodBankId_bloodGroup: {
                bloodBankId: bloodBankId,
                bloodGroup: donor.bloodGroup
              }
            },
            update: {
              unitsAvailable: { increment: 1 },
              status: 'Good'
            },
            create: {
              bloodBankId: bloodBankId,
              bloodGroup: donor.bloodGroup,
              unitsAvailable: 1,
              status: 'Good'
            }
          });
        }
      }
    });

    return res.json({ message: 'Progress updated successfully' });
  } catch (error) {
    console.error('Error updating progress:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: RSVP to a camp
router.post('/camps/:id/rsvp', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role; // "donor" or "bloodbank"
    const { id: campId } = req.params;
    const { role } = req.body; // "donor" or "volunteer"

    const camp = await db.camp.findUnique({ where: { id: campId } });
    if (!camp) return res.status(404).json({ error: 'Camp not found' });

    // Enforce role rules
    let finalRole = role;
    if (userRole === 'bloodbank') {
      finalRole = 'volunteer';
    } else if (userRole === 'donor' && role === 'donor') {
      const donor = await db.user.findUnique({ where: { id: userId } });
      if (!donor) return res.status(404).json({ error: 'Donor not found' });

      // Check 56-day rule
      if (donor.lastDonatedAt) {
        const daysSinceLastDonation = (new Date().getTime() - donor.lastDonatedAt.getTime()) / (1000 * 3600 * 24);
        if (daysSinceLastDonation < 56) {
          return res.status(403).json({ error: 'Not eligible to donate yet (56-day cooldown). Please join as a volunteer.' });
        }
      }
    }

    // Check if already RSVP'd
    const existingRsvp = await db.campRSVP.findUnique({
      where: {
        campId_userId: { campId, userId }
      }
    });

    if (existingRsvp) {
      return res.status(400).json({ error: 'You have already joined this camp.' });
    }

    await db.$transaction([
      db.campRSVP.create({
        data: {
          campId,
          userId,
          userType: userRole,
          role: finalRole
        }
      }),
      db.camp.update({
        where: { id: campId },
        data: { rsvps: { increment: 1 } }
      })
    ]);

    return res.status(201).json({ message: 'Successfully joined camp' });
  } catch (error) {
    console.error('Error joining camp:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Cancel RSVP
router.delete('/camps/:id/rsvp', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id: campId } = req.params;

    const existingRsvp = await db.campRSVP.findUnique({
      where: {
        campId_userId: { campId, userId }
      }
    });

    if (!existingRsvp) {
      return res.status(404).json({ error: 'RSVP not found' });
    }

    await db.$transaction([
      db.campRSVP.delete({
        where: { id: existingRsvp.id }
      }),
      db.camp.update({
        where: { id: campId },
        data: { rsvps: { decrement: 1 } }
      })
    ]);

    return res.json({ message: 'Successfully cancelled RSVP' });
  } catch (error) {
    console.error('Error cancelling RSVP:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
