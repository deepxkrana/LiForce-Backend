import { Router, Response } from 'express';
import { db } from '../db';
import { requireAuth, requireBloodBank, AuthRequest } from '../middleware/auth';
import { getWebSocketIO } from '../services/websocket';

const router = Router();

// Protected: Book a donation appointment (Donor only)
router.post('/donations/book', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const donorId = req.user!.id;
    const { bloodBankId, scheduledDate } = req.body;

    if (!bloodBankId || !scheduledDate) {
      return res.status(400).json({ error: 'Missing required parameters: bloodBankId and scheduledDate' });
    }

    // Fetch the donor to get name, blood group, and lastDonatedAt for cooldown check
    const donor = await db.user.findUnique({
      where: { id: donorId },
      select: { name: true, bloodGroup: true, lastDonatedAt: true }
    });

    if (!donor) {
      return res.status(404).json({ error: 'Donor not found' });
    }

    // 56-day cooldown enforcement
    if (donor.lastDonatedAt) {
      const COOLDOWN_DAYS = 56;
      const lastDate = new Date(donor.lastDonatedAt);
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

    // Fetch the blood bank to ensure it exists
    const bloodBank = await db.bloodBank.findUnique({
      where: { id: bloodBankId },
      select: { name: true }
    });

    if (!bloodBank) {
      return res.status(404).json({ error: 'Blood bank not found' });
    }

    // Create the donation
    const donation = await db.donation.create({
      data: {
        donorId,
        bloodBankId,
        scheduledDate: new Date(scheduledDate),
        status: 'Pending',
        pointsAwarded: 0
      },
      include: {
        bloodBank: {
          select: { name: true }
        }
      }
    });

    // Dispatch real-time WebSocket notification to the specific blood bank
    try {
      const io = getWebSocketIO();
      io.to(`user_${bloodBankId}`).emit('new_appointment_created', {
        id: donation.id,
        donorName: donor.name,
        bloodGroup: donor.bloodGroup,
        scheduledDate: donation.scheduledDate,
        status: donation.status
      });
      console.log(`📢 Real-time WebSocket: Donation booked at bloodbank_${bloodBankId} by ${donor.name}`);
    } catch (wsError) {
      console.error('⚠️ Failed to dispatch WebSocket alert for donation:', wsError);
    }

    return res.status(201).json({
      message: 'Donation appointment booked successfully',
      donation
    });
  } catch (error) {
    console.error('Error booking donation appointment:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Update donation status (Blood Bank only)
router.put('/donations/:id/status', requireAuth, requireBloodBank, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'Completed' or 'Cancelled'
    const bloodBankId = req.user!.id;

    if (!['Accepted', 'Completed', 'Cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be Accepted, Completed or Cancelled' });
    }

    // Fetch the donation to check if it exists and belongs to this blood bank
    const donation = await db.donation.findUnique({
      where: { id },
      include: { 
        donor: { select: { id: true, name: true, bloodGroup: true } },
        bloodBank: { select: { name: true } }
      }
    });

    if (!donation) {
      return res.status(404).json({ error: 'Donation appointment not found' });
    }

    if (donation.bloodBankId !== bloodBankId) {
      return res.status(403).json({ error: 'Forbidden: You do not have permission to update this donation' });
    }

    if (!['Pending', 'Accepted'].includes(donation.status)) {
      return res.status(400).json({ error: 'Donation has already been processed' });
    }

    // Update donation status
    const pointsAwarded = status === 'Completed' ? 100 : 0;
    const updatedDonation = await db.donation.update({
      where: { id },
      data: {
        status,
        pointsAwarded
      }
    });

    // If completed, update the donor's reward points and lastDonatedAt
    if (status === 'Completed') {
      await db.user.update({
        where: { id: donation.donorId },
        data: {
          rewardPoints: {
            increment: 100
          },
          lastDonatedAt: new Date()
        }
      });

      await db.bloodBank.update({
        where: { id: donation.bloodBankId },
        data: {
          rewardPoints: {
            increment: 100
          }
        }
      });

      // Increase inventory
      const existingInv = await db.inventory.findFirst({
        where: { bloodBankId, bloodGroup: donation.donor.bloodGroup }
      });
      if (existingInv) {
        await db.inventory.update({
          where: { id: existingInv.id },
          data: { unitsAvailable: { increment: 1 } }
        });
      } else {
        await db.inventory.create({
          data: {
            bloodBankId,
            bloodGroup: donation.donor.bloodGroup,
            unitsAvailable: 1,
            status: 'Low' // Will be recalced later or client side
          }
        });
      }
    }

    // Trigger a real-time WebSocket notification to the donor
    try {
      const io = getWebSocketIO();
      io.to(`user_${donation.donorId}`).emit('donation_status_updated', {
        id: updatedDonation.id,
        status: updatedDonation.status,
        pointsAwarded: updatedDonation.pointsAwarded,
        bloodBankName: donation.bloodBank.name
      });
      console.log(`📢 Real-time WebSocket: Donation ${id} status updated to ${status} for donor_${donation.donorId}`);
    } catch (wsError) {
      console.error('⚠️ Failed to dispatch WebSocket status update:', wsError);
    }

    return res.json({
      message: `Donation marked as ${status} successfully`,
      donation: updatedDonation
    });
  } catch (error) {
    console.error('Error updating donation status:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Cancel a donation appointment (Donor or Blood Bank)
router.put('/donations/:id/cancel', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Fetch the donation
    const donation = await db.donation.findUnique({
      where: { id },
      include: { 
        donor: { select: { id: true, name: true } }, 
        bloodBank: { select: { id: true, name: true } } 
      }
    });

    if (!donation) {
      return res.status(404).json({ error: 'Donation appointment not found' });
    }

    // Must be either the donor themselves or the blood bank
    if (donation.donorId !== userId && donation.bloodBankId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have permission to cancel this donation' });
    }

    if (donation.status !== 'Pending') {
      return res.status(400).json({ error: 'Only pending donations can be cancelled' });
    }

    // Update status to Cancelled
    const updated = await db.donation.update({
      where: { id },
      data: { status: 'Cancelled' }
    });

    // Notify the other party via WebSocket
    try {
      const io = getWebSocketIO();
      const targetRoom = userId === donation.donorId ? `user_${donation.bloodBankId}` : `user_${donation.donorId}`;
      io.to(targetRoom).emit('donation_cancelled', {
        id: donation.id,
        cancelledBy: userId === donation.donorId ? 'donor' : 'bloodbank',
        donorName: donation.donor.name,
        bloodBankName: donation.bloodBank.name
      });
    } catch (wsError) {
      console.error('WebSocket cancel notification error:', wsError);
    }

    return res.json({ message: 'Appointment cancelled successfully', donation: updated });
  } catch (error) {
    console.error('Error cancelling donation:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Reschedule a donation appointment (Donor only)
router.put('/donations/:id/reschedule', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { scheduledDate } = req.body;
    const donorId = req.user!.id;

    if (!scheduledDate) {
      return res.status(400).json({ error: 'Missing scheduledDate' });
    }

    // Fetch the donation
    const donation = await db.donation.findUnique({
      where: { id },
      include: { 
        donor: { select: { id: true, name: true } }, 
        bloodBank: { select: { id: true, name: true } } 
      }
    });

    if (!donation) {
      return res.status(404).json({ error: 'Donation appointment not found' });
    }

    if (donation.donorId !== donorId) {
      return res.status(403).json({ error: 'Forbidden: You do not have permission to reschedule this donation' });
    }

    if (donation.status !== 'Pending') {
      return res.status(400).json({ error: 'Only pending donations can be rescheduled' });
    }

    // Update scheduledDate
    const updated = await db.donation.update({
      where: { id },
      data: {
        scheduledDate: new Date(scheduledDate)
      }
    });

    // Dispatch real-time WebSocket notification to blood bank
    try {
      const io = getWebSocketIO();
      io.to(`user_${donation.bloodBankId}`).emit('appointment_rescheduled', {
        id: donation.id,
        donorName: donation.donor.name,
        newScheduledDate: updated.scheduledDate
      });
    } catch (wsError) {
      console.error('WebSocket reschedule notification error:', wsError);
    }

    return res.json({ message: 'Appointment rescheduled successfully', donation: updated });
  } catch (error) {
    console.error('Error rescheduling donation:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
