// Wallets module. Endpoints are built in Z4 (wallets) and Z5 (top-ups) (docs/TASKS.md). Skeleton only: no routes yet.
//
// Planned (docs/API_CONTRACT.md):
//   GET /wallet, GET /wallet/transactions, POST /topups, GET /topups/:id, POST /webhooks/paystack
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';

export function createWalletsRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
