// Z10 end to end on Stellar testnet: a nurse earns (the Z8 flow) and withdraws to a Stellar address.
//   npm run withdrawal:e2e -w @carelayer/api
// Needs apps/api/.env filled by `npm run testnet:setup` (treasury, facilitator key, test payer) and
// a migrated dev database. The withdrawal goes to the test payer wallet (it trusts USDC). The
// payment is signed by the nurse's custodial key and its fee is paid by the treasury (fee bump):
// her account holds no XLM.
import { pathToFileURL } from 'node:url';
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import { buildServices } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createDb, type Db } from '../src/db.js';
import { createLogger } from '../src/lib/logger.js';
import { createFacilitatorClient } from '../src/modules/payments/x402.js';
import { runAnswerE2E } from './answer-e2e.js';

const explorer = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

export async function runWithdrawalE2E(
  db: Db,
  config: Config,
  destinationSecret: string,
  log: (line: string) => void = console.log,
) {
  const earned = await runAnswerE2E(db, config, log);
  const payment = await db.payment.findUniqueOrThrow({
    where: { questionId: earned.questionId },
    include: { payout: true },
  });
  const nurseId = payment.payout!.nurseId;

  const services = buildServices({
    config,
    db,
    logger: createLogger('warn'),
    facilitator: createFacilitatorClient(config.x402),
  });
  const before = await services.earnings.earnings(nurseId);
  log(`[e2e] nurse available: ₦${before.available.kobo / 100} (${before.available.usdc} USDC)`);

  const destination = Keypair.fromSecret(destinationSecret).publicKey();
  const { body } = await services.earnings.withdraw(nurseId, {
    amountKobo: 10_000, // ₦100
    address: destination,
  });
  if (body.status !== 'confirmed' || !body.stellarTxHash) {
    throw new Error(`withdrawal not confirmed: ${body.status} ${body.failureReason ?? ''}`);
  }
  log(`[e2e] withdrawal (₦100 to ${destination.slice(0, 8)}…): ${explorer(body.stellarTxHash)}`);

  const tx = await new Horizon.Server(config.wallet.horizonUrl)
    .transactions()
    .transaction(body.stellarTxHash)
    .call();
  if (!tx.successful) throw new Error('withdrawal transaction was not successful');

  const after = await services.earnings.earnings(nurseId);
  return { withdrawal: body, before, after, payoutTxHash: earned.payoutTxHash };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  const destinationSecret = process.env.X402_TEST_PAYER_SECRET;
  if (!destinationSecret) {
    console.error('[e2e] X402_TEST_PAYER_SECRET is not set: run npm run testnet:setup first');
    process.exit(1);
  }
  runWithdrawalE2E(db, config, destinationSecret)
    .then(() => console.log('[e2e] done'))
    .catch((err) => {
      console.error('[e2e] failed:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
