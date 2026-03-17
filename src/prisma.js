import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Test connection on startup
prisma
  .$connect()
  .then(() => console.log("✅ Prisma connected to database"))
  .catch((err) => console.warn(`⚠️ Prisma connection error: ${err.message}`));

export default prisma;
