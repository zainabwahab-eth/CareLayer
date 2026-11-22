import { buildServices, createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createDb } from './db.js';
import { createLogger } from './lib/logger.js';
import { createFacilitatorClient } from './modules/payments/x402.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(
      `[api] ${err.message}\nCopy apps/api/.env.example to apps/api/.env and fill it in.`,
    );
    process.exit(1);
  }
  throw err;
}

const logger = createLogger(config.logLevel);
const db = createDb(config.databaseUrl);
// x402 facilitator: GET /questions/:id/answer (Z8) and the Z2 test route. Without a key the
// OpenZeppelin facilitator refuses calls, and paid answers answer 503 (free answers still work).
const facilitator =
  config.x402.facilitatorApiKey || config.x402.testRouteEnabled
    ? createFacilitatorClient(config.x402)
    : undefined;
if (!facilitator) {
  logger.warn('x402_disabled', {
    reason: 'X402_FACILITATOR_API_KEY is not set: paid answers answer 503',
  });
}
const deps = { config, db, logger, facilitator };
const services = buildServices(deps);
const { wallets, topups, cases, payouts, earnings } = services;
const app = createApp(deps, services);

const server = app.listen(config.port, () => {
  logger.info('api_listening', { url: `http://localhost:${config.port}`, nodeEnv: config.nodeEnv });
});

// Background loops, never overlapping themselves:
//   Z4 wallets (every minute): activate pending wallets whose backoff has passed.
//   Z5 top-ups (every minute): credit paid ones, check unpaid ones with Paystack, close abandoned ones.
//   Z8 payouts (every minute): send nurse payouts not confirmed yet.
//   Z10 withdrawals (every minute): settle withdrawals whose outcome was unknown.
//   Z7 sweeper (every 30 s): expire claims, open chosen-nurse questions after 10 min, expire
//   questions after 30 min. (Requests also apply these lazily, so a late tick is never wrong.)
function every(name: string, ms: number, run: () => Promise<Record<string, number>>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await run();
      if (Object.values(result).some((n) => n > 0)) logger.info(name, result);
    } catch (err) {
      logger.error(`${name}_failed`, { error: (err as Error).message });
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), ms).unref();
}
if (config.wallet.treasurySecret) {
  every('wallet_activation_loop', 60_000, () => wallets.activatePending());
} else {
  logger.warn('wallet_activation_disabled', { reason: 'STELLAR_TREASURY_SECRET is not set' });
}
if (config.paystack.secretKey) {
  every('topup_loop', 60_000, () => topups.processPending());
} else {
  logger.warn('topups_disabled', { reason: 'PAYSTACK_SECRET_KEY is not set' });
}

// Z8 payouts (every minute): send nurses' 80% that is not confirmed yet (retries with backoff).
if (config.wallet.treasurySecret) {
  every('payout_loop', 60_000, () => payouts.processPending());
  // Z10: settle withdrawals whose outcome was unknown (Stellar slow): found by memo, or failed.
  every('withdrawal_loop', 60_000, () => earnings.processPending());
} else {
  logger.warn('payouts_disabled', { reason: 'STELLAR_TREASURY_SECRET is not set' });
}

// The sweeper logs its own line when it changes something.
every('sweeper_tick', 30_000, async () => {
  await cases.sweep();
  return {};
});

async function shutdown(signal: string) {
  logger.info('api_shutdown', { signal });
  server.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
