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
// Only built when an x402 route is mounted (Z2 test route now; Z8 answers later).
const facilitator = config.x402.testRouteEnabled ? createFacilitatorClient(config.x402) : undefined;
const deps = { config, db, logger, facilitator };
const services = buildServices(deps);
const { wallets, topups } = services;
const app = createApp(deps, services);

const server = app.listen(config.port, () => {
  logger.info('api_listening', { url: `http://localhost:${config.port}`, nodeEnv: config.nodeEnv });
});

// Background loops, every minute, never overlapping themselves:
//   Z4 wallets: activate pending wallets whose backoff has passed.
//   Z5 top-ups: credit paid ones, check unpaid ones with Paystack, close abandoned ones.
function everyMinute(name: string, run: () => Promise<Record<string, number>>) {
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
  setInterval(() => void tick(), 60_000).unref();
}
if (config.wallet.treasurySecret) {
  everyMinute('wallet_activation_loop', () => wallets.activatePending());
} else {
  logger.warn('wallet_activation_disabled', { reason: 'STELLAR_TREASURY_SECRET is not set' });
}
if (config.paystack.secretKey) {
  everyMinute('topup_loop', () => topups.processPending());
} else {
  logger.warn('topups_disabled', { reason: 'PAYSTACK_SECRET_KEY is not set' });
}

async function shutdown(signal: string) {
  logger.info('api_shutdown', { signal });
  server.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
