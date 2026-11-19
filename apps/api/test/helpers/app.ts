import type { FacilitatorClient } from '@x402/core/server';
import { createApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import type { Db } from '../../src/db.js';
import { createLogger, type Logger } from '../../src/lib/logger.js';
import { testConfig } from './env.js';

export function buildTestApp(
  db: Db,
  opts: { config?: Partial<Config>; logger?: Logger; facilitator?: FacilitatorClient } = {},
) {
  return createApp({
    config: testConfig(opts.config),
    db,
    logger: opts.logger ?? createLogger('silent'),
    facilitator: opts.facilitator,
  });
}

/** A Db stand-in whose queries fail like a dead Postgres. Only $queryRaw is used by /health. */
export function deadDb(mode: 'reject' | 'hang' = 'reject'): Db {
  return {
    $queryRaw: () =>
      mode === 'reject'
        ? Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432'))
        : new Promise(() => {}),
  } as unknown as Db;
}
