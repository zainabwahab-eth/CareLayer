import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createDb } from './db.js';
import { createLogger } from './lib/logger.js';

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
const app = createApp({ config, db, logger });

const server = app.listen(config.port, () => {
  logger.info('api_listening', { url: `http://localhost:${config.port}`, nodeEnv: config.nodeEnv });
});

async function shutdown(signal: string) {
  logger.info('api_shutdown', { signal });
  server.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
