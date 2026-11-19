// Everything a router needs, passed in explicitly so tests can swap any piece.
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Logger } from './lib/logger.js';

export interface AppDeps {
  config: Config;
  db: Db;
  logger: Logger;
}
