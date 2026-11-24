// Adds an admin account. Admins cannot sign up through the API (POST /auth/code/request refuses
// app "admin" signups), so this is how another person gets /admin-console access.
//
//   npm run admin:add -w @carelayer/api -- <email> "<Name>"
//
// Against the deployed database (reads DATABASE_URL and WALLET_ENCRYPTION_KEY from that file):
//   cd apps/api && npx tsx --env-file=deploy/.env.production scripts/add-admin.ts <email> "<Name>"
//
// The account is created like the seed's admin: default settings and a custodial wallet encrypted
// with WALLET_ENCRYPTION_KEY. Safe to re-run: an existing admin with that email is left unchanged.
// She then signs in at /admin-console with that email (the code is emailed to her).
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { newCustodialWallet } from '../src/modules/wallets/crypto.js';

const [rawEmail, ...nameParts] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
const name = nameParts.join(' ').trim() || 'CareLayer Admin';

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: add-admin.ts <email> "<Name>"');
  process.exit(1);
}
if (name.length > 100) {
  console.error('The name can be up to 100 characters.');
  process.exit(1);
}

const config = loadConfig();
const db = createDb(config.databaseUrl);
try {
  const existing = await db.user.findUnique({ where: { email_role: { email, role: 'ADMIN' } } });
  if (existing) {
    console.log(`[admin] ${email} is already an admin (nothing changed).`);
  } else {
    const now = new Date();
    await db.user.create({
      data: {
        role: 'ADMIN',
        email,
        displayName: name,
        termsAcceptedAt: now,
        termsVersion: 'terms-v1',
        settings: { create: {} },
        notificationPreference: { create: { notifyWhenAnswered: true } },
        wallet: { create: newCustodialWallet(config.wallet.encryptionKey) },
      },
    });
    console.log(`[admin] created admin ${email} (${name}). Sign in at /admin-console.`);
  }
  const admins = await db.user.count({ where: { role: 'ADMIN' } });
  console.log(`[admin] admins in this database: ${admins}`);
} finally {
  await db.$disconnect();
}
