import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const d = await prisma.user.findFirst({ where: { name: 'Shubham Kumar' } });
  console.log(d);
}
main();
