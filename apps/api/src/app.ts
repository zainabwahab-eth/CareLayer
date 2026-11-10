// Express app factory. Kept separate from index.ts so tests can start it on a random port.
import { API_CONTRACT_VERSION, type HealthResponse } from '@carelayer/shared';
import cors from 'cors';
import express from 'express';
import type { Config } from './config.js';

export function createApp(config: Config) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      service: 'carelayer-api',
      contractVersion: API_CONTRACT_VERSION,
      time: new Date().toISOString(),
    };
    res.json(body);
  });

  return app;
}
