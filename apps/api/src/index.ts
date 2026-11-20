import { buildWalletService, createApp } from './app.js';
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
const wallets = buildWalletService(deps);
const app = createApp(deps, wallets);

const server = app.listen(config.port, () => {
  logger.info('api_listening', { url: `http://localhost:${config.port}`, nodeEnv: config.nodeEnv });
});

// Wallet activation retry loop (Z4): every minute, pending wallets whose backoff has passed.
let walletLoopRunning = false;
async function walletLoop() {
  if (walletLoopRunning) return;
  walletLoopRunning = true;
  try {
    const { attempted, activated } = await wallets.activatePending();
    if (attempted) logger.info('wallet_activation_loop', { attempted, activated });
  } catch (err) {
    logger.error('wallet_activation_loop_failed', { error: (err as Error).message });
  } finally {
    walletLoopRunning = false;
  }
}
if (config.wallet.treasurySecret) {
  void walletLoop();
  setInterval(() => void walletLoop(), 60_000).unref();
} else {
  logger.warn('wallet_activation_disabled', { reason: 'STELLAR_TREASURY_SECRET is not set' });
}

async function shutdown(signal: string) {
  logger.info('api_shutdown', { signal });
  server.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
