import { Router, Response } from 'express';
import { db } from '../db';
import { requireAuth, requireBloodBank, AuthRequest } from '../middleware/auth';

const router = Router();

// Public: Get aggregate available counts of blood groups across all verified partner blood banks
router.get('/bloodbanks/inventory/totals', async (req, res) => {
  try {
    const inventories = await db.inventory.findMany({
      where: {
        bloodBank: {
          isVerified: true
        }
      }
    });

    const totals: Record<string, number> = {
      'A+': 0, 'A-': 0,
      'B+': 0, 'B-': 0,
      'O+': 0, 'O-': 0,
      'AB+': 0, 'AB-': 0
    };

    inventories.forEach(inv => {
      if (totals[inv.bloodGroup] !== undefined) {
        totals[inv.bloodGroup] += inv.unitsAvailable;
      }
    });

    // Map units to statuses: Critical (< 10), Low (10 to 49), Good (>= 50)
    const bloodData = Object.entries(totals).map(([type, units]) => {
      let status: 'Critical' | 'Low' | 'Good' = 'Good';
      if (units < 10) {
        status = 'Critical';
      } else if (units < 50) {
        status = 'Low';
      }
      return { type, status, units };
    });

    return res.json(bloodData);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Public: Get all verified blood banks
router.get('/bloodbanks', async (req, res) => {
  try {
    const banks = await db.bloodBank.findMany({
      where: { isVerified: true },
      include: {
        inventory: true
      }
    });
    return res.json(banks);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Public: Get a specific blood bank's inventory
router.get('/bloodbanks/:id/inventory', async (req, res) => {
  try {
    const { id } = req.params;
    const inventory = await db.inventory.findMany({
      where: { bloodBankId: id },
    });
    return res.json(inventory);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Update blood bank inventory (Requires Blood Bank Auth)
router.put('/bloodbanks/me/inventory', requireAuth, requireBloodBank, async (req: AuthRequest, res: Response) => {
  try {
    const bloodBankId = req.user!.id;
    const { bloodGroup, unitsAvailable } = req.body;

    const units = parseInt(unitsAvailable) || 0;

    // Per-bank thresholds: Critical (< 5), Low (5-14), Good (>= 15)
    let status: 'Critical' | 'Low' | 'Good' = 'Good';
    if (units < 5) status = 'Critical';
    else if (units < 15) status = 'Low';

    const inventory = await db.inventory.upsert({
      where: {
        bloodBankId_bloodGroup: {
          bloodBankId,
          bloodGroup
        }
      },
      update: {
        unitsAvailable: units,
        status
      },
      create: {
        bloodBankId,
        bloodGroup,
        unitsAvailable: units,
        status
      }
    });

    return res.json({ message: 'Inventory updated', inventory });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Update blood bank profile
router.put('/bloodbanks/me', requireAuth, requireBloodBank, async (req: AuthRequest, res: Response) => {
  try {
    const bloodBankId = req.user!.id;
    const { name, phone, address, latitude, longitude, email, isOpen } = req.body;

    const updated = await db.bloodBank.update({
      where: { id: bloodBankId },
      data: {
        ...(name && { name }),
        ...(phone && { phone }),
        ...(address && { address }),
        ...(email && { email }),
        ...(isOpen !== undefined && { isOpen }),
        ...(latitude && { latitude: Number(latitude) }),
        ...(longitude && { longitude: Number(longitude) }),
      },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        isOpen: true,
        latitude: true,
        longitude: true,
      }
    });

    return res.json({ message: 'Profile updated successfully', bank: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Protected: Get dashboard data
router.get('/bloodbanks/me/dashboard', requireAuth, requireBloodBank, async (req: AuthRequest, res: Response) => {
  try {
    const bloodBankId = req.user!.id;
    const bank = await db.bloodBank.findUnique({
      where: { id: bloodBankId },
      include: {
        inventory: true,
        donations: {
          include: { donor: true },
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!bank) return res.status(404).json({ error: 'Blood bank not found' });

    // Pending requests globally or near this bank
    const pendingRequests = await db.emergencyRequest.findMany({
      where: { 
        status: 'Active',
        OR: [
          { assignedBloodBankId: null },
          { assignedBloodBankId: bloodBankId }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    const camps = await db.camp.findMany({
      where: { organizerId: bloodBankId },
      orderBy: { date: 'asc' }
    });

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date();
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    const monthDonations = await db.donation.findMany({
      where: {
        bloodBankId,
        status: 'Completed',
        updatedAt: { gte: startOfMonth, lte: endOfMonth }
      }
    });

    const monthFulfilled = await db.emergencyRequest.findMany({
      where: {
        assignedBloodBankId: bloodBankId,
        status: 'Fulfilled',
        updatedAt: { gte: startOfMonth, lte: endOfMonth }
      }
    });

    const weeklyTrends = [
      { week: 'Week 1', units: 0 },
      { week: 'Week 2', units: 0 },
      { week: 'Week 3', units: 0 },
      { week: 'Week 4', units: 0 },
    ];

    const getWeekIndex = (date: Date) => {
      const day = date.getDate();
      if (day <= 7) return 0;
      if (day <= 14) return 1;
      if (day <= 21) return 2;
      return 3;
    };

    monthDonations.forEach(d => {
      weeklyTrends[getWeekIndex(d.updatedAt)].units += 1;
    });

    monthFulfilled.forEach(r => {
      weeklyTrends[getWeekIndex(r.updatedAt)].units += r.unitsRequired;
    });

    return res.json({ bank, pendingRequests, camps, weeklyTrends });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Public: Get leaderboard for blood banks
router.get('/bloodbanks/leaderboard', async (req, res) => {
  try {
    const leaderboard = await db.bloodBank.findMany({
      where: { isVerified: true },
      select: {
        id: true,
        name: true,
        address: true,
        rewardPoints: true,
        _count: {
          select: {
            donations: {
              where: { status: 'Completed' }
            }
          }
        }
      },
      orderBy: {
        rewardPoints: 'desc'
      },
      take: 100
    });
    const bankIds = leaderboard.map(b => b.id);

    const emergenciesCounts = await db.emergencyRequest.groupBy({
      by: ['assignedBloodBankId'],
      where: {
        assignedBloodBankId: { in: bankIds },
        status: 'Fulfilled'
      },
      _count: {
        id: true
      }
    });

    const emergencyCountMap = new Map(
      emergenciesCounts
        .filter(ec => ec.assignedBloodBankId !== null)
        .map(ec => [ec.assignedBloodBankId, ec._count.id])
    );

    const formattedLeaderboard = leaderboard.map(bank => {
      const emergencyDonations = emergencyCountMap.get(bank.id) || 0;
      return {
        ...bank,
        _count: {
          ...bank._count,
          donations: bank._count.donations + emergencyDonations
        }
      };
    });

    return res.json(formattedLeaderboard);
  } catch (error) {
    console.error('Blood Bank Leaderboard error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
