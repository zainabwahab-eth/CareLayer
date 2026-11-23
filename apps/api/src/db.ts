// Prisma 7 client with the node-postgres driver adapter.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export type Db = PrismaClient;

export function createDb(databaseUrl: string): Db {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    // 10 s: Neon's free compute sleeps when idle and needs a moment to wake, and on Cloud Run
    // (scale to zero, CPU only during requests) a cold connection can take longer than 3 s.
    // /health stays fast: pingDatabase() has its own 2 s limit.
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({ adapter });
}

/** Resolves true when the database answers `SELECT 1` within `timeoutMs`. Never throws. */
export async function pingDatabase(db: Pick<Db, '$queryRaw'>, timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    const ping = db.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    );
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
