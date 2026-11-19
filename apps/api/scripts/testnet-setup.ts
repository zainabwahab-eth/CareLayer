// One-time Stellar TESTNET setup for x402 (Z2). Safe to re-run: every step is idempotent.
//
//   npm run testnet:setup -w @carelayer/api
//
// 1. Treasury wallet (receives x402 payments; later pays nurses and top-ups):
//    keypair -> Friendbot (10,000 XLM) -> USDC trustline -> buys test USDC with XLM on the testnet DEX.
// 2. Test payer wallet (plays the agent in scripts/pay-x402.ts): same steps, smaller USDC float.
// 3. OpenZeppelin Channels testnet API key for the facilitator (anonymous, no account needed).
// 4. Writes STELLAR_TREASURY_SECRET, X402_PAY_TO_ADDRESS, X402_TEST_PAYER_SECRET,
//    X402_FACILITATOR_API_KEY and STELLAR_USDC_ISSUER into apps/api/.env, ONLY where empty.
//    Never overwrites a value, never prints a secret.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import { fillEnv, readEnvValue } from '../src/lib/env-file.js';
import { stroopsToUsdcString } from '../src/lib/money.js';
import {
  createStellarTestnet,
  TESTNET_USDC_ISSUER,
} from '../src/modules/payments/stellar-testnet.js';

const ENV_PATH = resolve(import.meta.dirname, '../.env');
const KEY_GEN_URL = 'https://channels.openzeppelin.com/testnet/gen';
const explorer = (a: string) => `https://stellar.expert/explorer/testnet/account/${a}`;

const stellar = createStellarTestnet();

async function prepareWallet(
  label: string,
  secret: string | undefined,
  buyXlm: string,
  minUsdc: bigint,
) {
  const kp = secret ? Keypair.fromSecret(secret) : Keypair.random();
  console.log(`\n[${label}] ${kp.publicKey()}${secret ? ' (from .env)' : ' (new)'}`);
  console.log(`[${label}] friendbot: ${await stellar.fundWithFriendbot(kp.publicKey())}`);
  const trust = await stellar.ensureUsdcTrustline(kp);
  console.log(`[${label}] USDC trustline: ${trust ? `added (${trust})` : 'already there'}`);
  const before = await stellar.usdcBalanceStroops(kp.publicKey());
  if (before < minUsdc) {
    const hash = await stellar.buyUsdcWithXlm(kp, buyXlm, minUsdc - before);
    console.log(`[${label}] bought USDC with ${buyXlm} XLM (${hash})`);
  }
  const after = await stellar.usdcBalanceStroops(kp.publicKey());
  console.log(
    `[${label}] USDC balance: ${stroopsToUsdcString(after)}  ${explorer(kp.publicKey())}`,
  );
  return kp;
}

async function generateFacilitatorKey(): Promise<string> {
  const res = await fetch(KEY_GEN_URL);
  if (!res.ok) throw new Error(`Facilitator key generation failed: HTTP ${res.status}`);
  const body = (await res.json()) as { apiKey?: string };
  if (!body.apiKey) throw new Error('Facilitator key generation returned no apiKey');
  return body.apiKey;
}

const envText = readFileSync(ENV_PATH, 'utf8');

const treasury = await prepareWallet(
  'treasury',
  readEnvValue(envText, 'STELLAR_TREASURY_SECRET'),
  '300',
  100_000_000n,
); // >= 10 USDC
const payer = await prepareWallet(
  'test payer',
  readEnvValue(envText, 'X402_TEST_PAYER_SECRET'),
  '20',
  10_000_000n,
); // >= 1 USDC

const existingKey = readEnvValue(envText, 'X402_FACILITATOR_API_KEY');
const apiKey = existingKey ?? (await generateFacilitatorKey());
console.log(
  `\n[facilitator] API key: ${existingKey ? 'kept from .env' : 'generated'} (not printed)`,
);

const { text, results } = fillEnv(envText, {
  STELLAR_TREASURY_SECRET: treasury.secret(),
  X402_PAY_TO_ADDRESS: treasury.publicKey(),
  X402_TEST_PAYER_SECRET: payer.secret(),
  X402_FACILITATOR_API_KEY: apiKey,
  STELLAR_USDC_ISSUER: TESTNET_USDC_ISSUER,
});
writeFileSync(ENV_PATH, text);
for (const r of results) console.log(`[.env] ${r.key}: ${r.action}`);

const payTo = readEnvValue(text, 'X402_PAY_TO_ADDRESS');
if (payTo !== treasury.publicKey()) {
  console.warn(
    `\n[warn] X402_PAY_TO_ADDRESS in .env (${payTo}) is not the treasury (${treasury.publicKey()}).`,
  );
}
console.log(
  '\nDone. Set X402_TEST_ROUTE=true in apps/api/.env, start the API, then run: npm run x402:pay -w @carelayer/api',
);
