import { Router, Response } from 'express';
import { db } from '../db';
import { requireAuth, requireBloodBank, AuthRequest } from '../middleware/auth';
import { getWebSocketIO } from '../services/websocket';

const router = Router();

// Protected: Organise a blood camp (Blood Bank only)
router.post('/camps/create', requireAuth, requireBloodBank, async (req: AuthRequest, res: Response) => {
  try {
    const bloodBankId = req.user!.id;
    const { title, date, location, description, capacity } = req.body;

    if (!title || !date || !location) {
      return res.status(400).json({ error: 'Missing required parameters: title, date, and location' });
    }

    // Fetch the blood bank to get name
    const bloodBank = await db.bloodBank.findUnique({
      where: { id: bloodBankId },
      select: { name: true }
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
        rsvps: 0,
        capacity: capacity ? parseInt(capacity, 10) : 50
      }
    });

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
    const { title, date, location, description, capacity } = req.body;

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
