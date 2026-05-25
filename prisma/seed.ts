import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Clean old data
  await prisma.otp.deleteMany();
  await prisma.donation.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.emergencyRequest.deleteMany();
  await prisma.post.deleteMany();
  await prisma.camp.deleteMany();
  await prisma.user.deleteMany();
  await prisma.bloodBank.deleteMany();

  const passwordHash = await bcrypt.hash('password', 10);

  // 1. Create Donors (Users)
  console.log('👤 Seeding donors...');
  const donor1 = await prisma.user.create({
    data: {
      email: 'donor1@liforce.org',
      passwordHash,
      name: 'Amit Sharma',
      bloodGroup: 'O-',
      phone: '9876543210',
      latitude: 30.7398,
      longitude: 76.7827,
      city: 'Chandigarh',
      rewardPoints: 0,
      isVerified: true,
      maxTravelDistanceKm: 15,
      notificationsEnabled: true
    }
  });

  const donor2 = await prisma.user.create({
    data: {
      email: 'donor2@liforce.org',
      passwordHash,
      name: 'Priya Patel',
      bloodGroup: 'B+',
      phone: '9876543211',
      latitude: 30.7188,
      longitude: 76.8105,
      city: 'Panchkula',
      rewardPoints: 0,
      isVerified: true,
      maxTravelDistanceKm: 10,
      notificationsEnabled: true
    }
  });

  const donor3 = await prisma.user.create({
    data: {
      email: 'donor3@liforce.org',
      passwordHash,
      name: 'Rohan Singh',
      bloodGroup: 'A+',
      phone: '9876543212',
      latitude: 30.7235,
      longitude: 76.7680,
      city: 'Mohali',
      rewardPoints: 0,
      isVerified: true,
      maxTravelDistanceKm: 20,
      notificationsEnabled: true
    }
  });

  // 2. Create Blood Banks
  console.log('🏥 Seeding blood banks...');
  const bb1 = await prisma.bloodBank.create({
    data: {
      name: 'Rotary Blood Bank',
      email: 'rotary@liforce.org',
      passwordHash,
      licenseNumber: 'L-12345/CHD',
      address: 'Sector 37, Chandigarh',
      latitude: 30.7342,
      longitude: 76.7582,
      phone: '0172-2606555',
      isVerified: true
    }
  });

  const bb2 = await prisma.bloodBank.create({
    data: {
      name: 'PGIMER Blood Center',
      email: 'pgimer@liforce.org',
      passwordHash,
      licenseNumber: 'L-98765/CHD',
      address: 'Sector 12, Chandigarh',
      latitude: 30.7628,
      longitude: 76.7766,
      phone: '0172-2747585',
      isVerified: true
    }
  });

  // 3. Create Inventories
  console.log('🩸 Seeding inventories...');
  const bloodGroups = ['O-', 'O+', 'B-', 'B+', 'A-', 'A+', 'AB-', 'AB+'];
  for (const group of bloodGroups) {
    await prisma.inventory.create({
      data: {
        bloodBankId: bb1.id,
        bloodGroup: group,
        unitsAvailable: Math.floor(Math.random() * 25) + 5,
        status: Math.random() > 0.8 ? 'Low' : 'Good'
      }
    });

    await prisma.inventory.create({
      data: {
        bloodBankId: bb2.id,
        bloodGroup: group,
        unitsAvailable: Math.floor(Math.random() * 40) + 10,
        status: Math.random() > 0.85 ? 'Critical' : 'Good'
      }
    });
  }

  // 4. Create Community Posts
  console.log('💬 Seeding community posts...');
  await prisma.post.create({
    data: {
      authorId: donor1.id,
      authorType: 'donor',
      authorName: 'Amit Sharma',
      authorInitials: 'AS',
      content: 'Just finished my 5th donation today! Super easy process at PGIMER, the staff was extremely friendly. Highly recommend everyone to donate, it takes just 15 minutes to save a life! 🩸❤️',
      likes: 24
    }
  });

  await prisma.post.create({
    data: {
      authorId: bb1.id,
      authorType: 'bloodbank',
      authorName: 'Rotary Blood Bank',
      authorInitials: 'RB',
      content: '🚨 CRITICAL SHORTAGE: We are currently extremely low on O- and A+ blood types. If you are eligible to donate, please drop by our Sector 37 branch this week. Walk-ins are fully welcome!',
      likes: 45
    }
  });

  // 5. Create Camps
  console.log('🏕️ Seeding camps...');
  await prisma.camp.create({
    data: {
      organizerId: bb1.id,
      organizerName: 'Rotary Blood Bank',
      title: 'Mega Summer Donation Camp',
      date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
      location: 'Sukhna Lake Club, Sector 1, Chandigarh',
      description: 'Join us for our annual mega donation drive by the lake. Free refreshments, health checkups, and certificates for all donors. Let\'s beat the summer shortage together!',
      rsvps: 12
    }
  });

  await prisma.camp.create({
    data: {
      organizerId: bb2.id,
      organizerName: 'PGIMER Blood Center',
      title: 'Campus Blood Drive',
      date: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000), // 12 days from now
      location: 'Student Centre, Panjab University, Chandigarh',
      description: 'Annual youth blood drive in collaboration with PU Student Council. Music, rewards, and exciting badges for student donors!',
      rsvps: 34
    }
  });

  // 6. Create active Emergency SOS
  console.log('🚨 Seeding active emergency request...');
  await prisma.emergencyRequest.create({
    data: {
      requesterId: donor3.id,
      patientName: 'Ramesh Sen',
      bloodGroup: 'O-',
      unitsRequired: 2,
      hospitalName: 'PGIMER, Chandigarh',
      latitude: 30.7628,
      longitude: 76.7766,
      urgency: 'Critical',
      status: 'Active'
    }
  });

  console.log('🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
