// GET /health: 200 when Postgres answers, 503 when it does not (docs/API_CONTRACT.md §1).
import { API_CONTRACT_VERSION, type HealthResponse } from '@carelayer/shared';
import { Router } from 'express';
import { pingDatabase } from '../../db.js';
import type { AppDeps } from '../../deps.js';

export function createHealthRouter({ db, logger }: AppDeps): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    const databaseOk = await pingDatabase(db);
    const body: HealthResponse = {
      status: databaseOk ? 'ok' : 'unavailable',
      database: databaseOk ? 'ok' : 'down',
      service: 'carelayer-api',
      contractVersion: API_CONTRACT_VERSION,
      time: new Date().toISOString(),
    };
    if (!databaseOk) logger.warn('health_database_down');
    res.setHeader('Cache-Control', 'no-store');
    res.status(databaseOk ? 200 : 503).json(body);
  });

  return router;
}
