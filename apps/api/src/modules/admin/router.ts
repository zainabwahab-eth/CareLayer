// Admin module. Endpoints are built in Z9 (docs/TASKS.md). Skeleton only: no routes yet.
//
// Planned (docs/API_CONTRACT.md):
//   GET /admin/nurses, GET /admin/nurses/:id, POST /admin/nurses/:id/approve|reject
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';

export function createAdminRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
