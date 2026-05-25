import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.get('/stats', async (req, res) => {
  try {
    const donorsCount = await prisma.user.count();
    const banksCount = await prisma.bloodBank.count();
    const regularDonationsCount = await prisma.donation.count({
      where: { status: 'Completed' }
    });
    
    const fulfilledEmergenciesCount = await prisma.emergencyRequest.count({
      where: { status: 'Fulfilled' }
    });
    
    const donationsCount = regularDonationsCount + fulfilledEmergenciesCount;

    res.json({
      donors: donorsCount,
      bloodbanks: banksCount,
      donations: donationsCount,
      avgResponseTime: 30
    });
  } catch (error) {
    console.error("Stats API Error:", error);
    res.status(500).json({ error: 'Internal server error fetching stats' });
  }
});

export default router;
