// CLI: `npm run db:seed -w @carelayer/api` (also used by `prisma db seed`).
import { ConfigError, loadConfig } from '../config.js';
import { createDb } from '../db.js';
import { stroopsToKobo } from '../lib/money.js';
import { seed } from './seed.js';

try {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  try {
    const summary = await seed(db, {
      answerPriceKobo: config.answerPriceKobo,
      ngnPerUsdc: config.ngnPerUsdc,
      nodeEnv: config.nodeEnv,
      walletEncryptionKey: config.wallet.encryptionKey,
    });
    const balanceNaira =
      stroopsToKobo(BigInt(summary.tolu.cachedBalanceStroops), config.ngnPerUsdc) / 100;
    console.log('[seed] done');
    console.log('[seed] users:', summary.users);
    console.log('[seed] questions by status:', summary.questionsByStatus);
    console.log('[seed] counts:', summary.counts);
    console.log(
      `[seed] Tolu: ${summary.tolu.freeAnswersLeft} free answers left, balance ₦${balanceNaira.toLocaleString('en-NG')}`,
    );
    console.table(
      summary.nurses.map((n) => ({
        name: n.name,
        role: n.role,
        status: n.status,
        years: n.years,
        languages: n.languages.join(', '),
        topics: n.topics.join(', '),
        avgResponseMin: n.avgResponseMinutes ?? '-',
        helpful: n.helpful.percent === null ? '-' : `${n.helpful.percent}% (${n.helpful.count})`,
      })),
    );
  } finally {
    await db.$disconnect();
  }
} catch (err) {
  console.error(err instanceof ConfigError ? `[seed] ${err.message}` : err);
  process.exit(1);
}
