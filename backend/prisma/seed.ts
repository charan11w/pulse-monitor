import { PrismaClient } from '@prisma/client';
import { makeSeedHashes, seedDemo } from './seed-data.js';

const prisma = new PrismaClient();

async function main() {
  const hashes = await makeSeedHashes(
    process.env.SEED_PASSWORD || '', process.env.SEED_API_KEY || '',
  );
  const result = await prisma.$transaction(
    (tx) => seedDemo(tx, hashes), { timeout: 10000 },
  );
  console.log('Demo seed complete. New events: ' + result.count);
  console.log('Local owner: demo@pulsemonitor.local. Credentials remain in the root .env.');
}

main()
  .catch(() => {
    // Prisma errors may include connection/record details; do not dump them.
    console.error('Seed failed. Check local database/migrations and reserved demo IDs. No partial seed was committed.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
