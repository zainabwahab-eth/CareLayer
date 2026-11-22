// Z8 end to end on Stellar testnet: one full question flow with REAL transactions.
//   npm run answer:e2e -w @carelayer/api
// Needs apps/api/.env filled by `npm run testnet:setup` (treasury with test USDC, facilitator key)
// and a migrated dev database. It writes demo rows (a woman, a nurse, an answered question) to
// the dev database and prints both explorer links:
//   1. her x402 payment (her custodial wallet -> platform), settled by the facilitator;
//   2. the nurse's 80% payout (treasury -> nurse wallet).
// The testnet integration test (test/testnet/answers.testnet.test.ts) runs the same flow.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Horizon } from '@stellar/stellar-sdk';
import { buildServices, type AppServices } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createDb, type Db } from '../src/db.js';
import { createLogger } from '../src/lib/logger.js';
import { koboToStroops } from '../src/lib/money.js';
import { createHorizonTopupChain } from '../src/modules/topups/chain.js';
import { createFacilitatorClient } from '../src/modules/payments/x402.js';
import { newCustodialWallet } from '../src/modules/wallets/crypto.js';

const explorer = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

export interface AnswerE2EResult {
  questionId: string;
  paymentTxHash: string;
  payoutTxHash: string;
  payoutStroops: bigint;
}

export async function runAnswerE2E(
  db: Db,
  config: Config,
  log: (line: string) => void = console.log,
): Promise<AnswerE2EResult> {
  if (!config.wallet.treasurySecret) throw new Error('STELLAR_TREASURY_SECRET is not set');
  if (!config.x402.facilitatorApiKey) throw new Error('X402_FACILITATOR_API_KEY is not set');

  const deps = {
    config,
    db,
    logger: createLogger('warn'),
    facilitator: createFacilitatorClient(config.x402),
  };
  const services: AppServices = buildServices(deps);
  const tag = randomUUID().slice(0, 8);

  // 1. A woman with no free answers left, and a nurse. Both get real sponsored wallets.
  const woman = await db.user.create({
    data: {
      role: 'WOMAN',
      email: `e2e-woman-${tag}@example.com`,
      displayName: 'E2E Woman',
      freeAnswersUsed: 3,
      wallet: { create: newCustodialWallet(config.wallet.encryptionKey) },
    },
  });
  const nurse = await db.user.create({
    data: {
      role: 'NURSE',
      email: `e2e-nurse-${tag}@example.com`,
      displayName: 'E2E Nurse',
      wallet: { create: newCustodialWallet(config.wallet.encryptionKey) },
      nurseProfile: {
        create: {
          fullName: 'E2E Nurse',
          role: 'MIDWIFE',
          gender: 'FEMALE',
          languages: ['ENGLISH'],
          licenceNumber: `E2E-${tag}`,
          verificationStatus: 'APPROVED',
        },
      },
    },
  });
  for (const u of [woman, nurse]) {
    const outcome = await services.wallets.activate(u.id);
    if (outcome !== 'activated' && outcome !== 'already_active') {
      throw new Error(`wallet activation for ${u.role} failed: ${outcome}`);
    }
  }
  log(`[e2e] wallets active (woman ${tag}, nurse ${tag})`);

  // 2. Fund her wallet from the treasury (stands in for a Paystack top-up).
  const womanWallet = await services.wallets.ensureWallet(woman.id);
  const treasury = createHorizonTopupChain({
    horizonUrl: config.wallet.horizonUrl,
    treasurySecret: config.wallet.treasurySecret,
  });
  const fund = await treasury.sendUsdc(womanWallet.stellarPublicKey, 5_000_000n, `e2e-${tag}`);
  log(`[e2e] funded her wallet with 0.5 USDC: ${explorer(fund.txHash)}`);

  // 3. An answered question (claiming and answering are Z7's, tested there).
  const now = new Date();
  const q = await db.question.create({
    data: {
      womanId: woman.id,
      source: 'WEB',
      status: 'ANSWERED',
      originalText: 'E2E: is a 40-day cycle normal?',
      cleanedText: 'E2E: Is a 40-day cycle normal?',
      topicSlug: 'periods',
      expiresAt: new Date(now.getTime() + 30 * 60_000),
      priceKobo: config.answerPriceKobo,
      priceStroops: koboToStroops(config.answerPriceKobo, config.ngnPerUsdc),
      isFree: false,
      answeredAt: now,
      consent: { create: { sharedFields: ['CLEANED_TEXT', 'CATEGORY'], consentVersion: 'e2e' } },
    },
  });
  const claim = await db.claim.create({
    data: {
      questionId: q.id,
      nurseId: nurse.id,
      status: 'ANSWERED',
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      endedAt: now,
    },
  });
  await db.answer.create({
    data: {
      questionId: q.id,
      claimId: claim.id,
      nurseId: nurse.id,
      text: 'E2E answer: cycles of 21 to 35 days are normal.',
    },
  });

  // 4. The API's own agent collects it: x402 from her custodial wallet, settled by the facilitator.
  const collected = await services.answers.collect(woman.id, q.id, { approvedAboveLimit: true });
  const paymentTxHash = collected.payment.stellarTxHash!;
  log(`[e2e] her x402 payment: ${explorer(paymentTxHash)}`);

  // 5. The nurse's 80% (sent in the background after collection; send() is idempotent).
  const payment = await db.payment.findUniqueOrThrow({
    where: { questionId: q.id },
    include: { payout: true },
  });
  let payout = payment.payout!;
  for (let i = 0; i < 30 && payout.status !== 'CONFIRMED'; i++) {
    payout = await services.payouts.send(payout.id);
    if (payout.status !== 'CONFIRMED') await new Promise((r) => setTimeout(r, 2_000));
  }
  if (payout.status !== 'CONFIRMED') {
    throw new Error(`payout not confirmed: ${payout.failureReason ?? payout.status}`);
  }
  log(`[e2e] nurse payout (80%): ${explorer(payout.stellarTxHash!)}`);

  // 6. Both are successful on chain.
  const horizon = new Horizon.Server(config.wallet.horizonUrl);
  for (const hash of [paymentTxHash, payout.stellarTxHash!]) {
    const tx = await horizon.transactions().transaction(hash).call();
    if (!tx.successful) throw new Error(`transaction ${hash} was not successful`);
  }
  return {
    questionId: q.id,
    paymentTxHash,
    payoutTxHash: payout.stellarTxHash!,
    payoutStroops: payout.amountStroops,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  runAnswerE2E(db, config)
    .then(() => console.log('[e2e] done'))
    .catch((err) => {
      console.error('[e2e] failed:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
