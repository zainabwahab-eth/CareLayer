// Everything a router needs, passed in explicitly so tests can swap any piece.
import type { FacilitatorClient } from '@x402/core/server';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Logger } from './lib/logger.js';

export interface AppDeps {
  config: Config;
  db: Db;
  logger: Logger;
  /**
   * x402 facilitator (verify / settle). Real one: createFacilitatorClient(config.x402).
   * Tests pass a fake so no network call is made. Required when an x402 route is mounted.
   */
  facilitator?: FacilitatorClient;
}
