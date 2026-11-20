// Admin module. Endpoints are built in Z9.
//
// Planned (docs/API_CONTRACT.md):
//   GET /admin/nurses, GET /admin/nurses/:id, POST /admin/nurses/:id/approve|reject
//
// Z3: everything under /admin/* requires a signed-in ADMIN (guard on the prefix).
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export function createAdminRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(
    '/admin',
    requireAuth({
      db: deps.db,
      jwtAccessSecret: deps.config.auth.jwtAccessSecret,
      now: deps.clock ?? (() => new Date()),
    }),
    requireRole('admin'),
  );
  return router;
}
