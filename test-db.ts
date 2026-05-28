import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const bb = await prisma.bloodBank.findMany();
  console.log("Blood Banks:", bb.map(b => ({name: b.name, lat: b.latitude, lng: b.longitude})));
  const donors = await prisma.user.findMany();
  console.log("Donors:", donors.map(d => ({name: d.name, lat: d.latitude, lng: d.longitude})));
}
main();
