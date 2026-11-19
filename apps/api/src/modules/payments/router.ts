// Payments module. Endpoints are built in Z2 (x402 proof) and Z8 (pay on delivery + payouts) (docs/TASKS.md). Skeleton only: no routes yet.
//
// Planned (docs/API_CONTRACT.md):
//   x402 middleware, settlement and the 80/20 payout service. GET /x402-test (Z2 only).
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';

export function createPaymentsRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
