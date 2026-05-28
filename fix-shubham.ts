import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.user.update({
    where: { email: 'raishubham309@gmail.com' },
    data: { lastDonatedAt: null }
  });
  console.log("Fixed Shubham");
}
main();
