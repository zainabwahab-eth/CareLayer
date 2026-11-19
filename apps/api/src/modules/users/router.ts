// Users module. Endpoints are built in Z3 (me) and Z6/H7 (settings) (docs/TASKS.md). Skeleton only: no routes yet.
//
// Planned (docs/API_CONTRACT.md):
//   GET/PATCH /me, GET/PATCH /me/settings, GET/PATCH /me/notifications
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';

export function createUsersRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
