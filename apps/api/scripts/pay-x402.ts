// Z2 proof: pay GET /x402-test over x402 as a client agent, and print the Stellar tx hash.
//
//   npm run x402:pay -w @carelayer/api [-- http://localhost:4000/x402-test]
//
// Needs the API running with X402_TEST_ROUTE=true, and X402_TEST_PAYER_SECRET in apps/api/.env
// (run `npm run testnet:setup -w @carelayer/api` once).
//
// Step 1 calls ?ready=false: the pay-on-delivery guard must answer 409 and the payer's balance must
// not move. Step 2 pays 0.01 USDC and prints the explorer link.
import { Keypair } from '@stellar/stellar-sdk';
import { stroopsToUsdcString } from '../src/lib/money.js';
import { createStellarTestnet } from '../src/modules/payments/stellar-testnet.js';
import {
  createPayingFetch,
  readSettlement,
  testnetExplorerTxUrl,
} from '../src/modules/payments/x402-client.js';

const url = process.argv[2] ?? 'http://localhost:4000/x402-test';
const secret = process.env.X402_TEST_PAYER_SECRET;
if (!secret) {
  console.error('X402_TEST_PAYER_SECRET is not set. Run: npm run testnet:setup -w @carelayer/api');
  process.exit(1);
}

const payer = Keypair.fromSecret(secret).publicKey();
const stellar = createStellarTestnet();
const payingFetch = createPayingFetch(secret, 'stellar:testnet');
const balance = async () => stroopsToUsdcString(await stellar.usdcBalanceStroops(payer));

console.log(`payer ${payer}`);
console.log(`USDC before: ${await balance()}`);

// 1. Guard: not ready -> 409, no payment requested.
const notReady = await payingFetch(`${url}?ready=false`);
console.log(`\n1) GET ?ready=false -> ${notReady.status} ${JSON.stringify(await notReady.json())}`);
console.log(
  `   PAYMENT-REQUIRED header: ${notReady.headers.get('PAYMENT-REQUIRED') ? 'present (BUG)' : 'none'}`,
);
console.log(`   USDC after guard: ${await balance()}`);

// 2. Pay 0.01 USDC.
const started = Date.now();
const paid = await payingFetch(url);
const body = await paid.json();
console.log(
  `\n2) GET ${url} -> ${paid.status} in ${Date.now() - started} ms ${JSON.stringify(body)}`,
);
const settlement = readSettlement(paid);
if (paid.status !== 200 || !settlement?.transaction) {
  console.error('Payment did not settle.');
  process.exit(1);
}
console.log(`   tx hash: ${settlement.transaction}`);
console.log(`   explorer: ${testnetExplorerTxUrl(settlement.transaction)}`);
console.log(`   USDC after payment: ${await balance()}`);
