import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './env.js';

const globalForPrisma = globalThis;

function createPrisma() {
  if (!config.databaseUrl) {
    return new PrismaClient({ log: config.isDev ? ['query', 'error', 'warn'] : ['error'] });
  }
  const adapter = new PrismaPg({ connectionString: config.databaseUrl });
  return new PrismaClient({
    adapter,
    log: config.isDev ? ['query', 'error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();
if (config.isDev) globalForPrisma.prisma = prisma;

export async function connectDb() {
  try {
    await prisma.$connect();
    return true;
  } catch (err) {
    console.error('[db] Connection failed:', err.message);
    return false;
  }
}

export async function disconnectDb() {
  await prisma.$disconnect();
}
