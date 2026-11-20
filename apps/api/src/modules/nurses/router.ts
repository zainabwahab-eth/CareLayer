// Nurses module. Endpoints are built in Z6 (directory), Z7 (claims), Z9 (onboarding), Z10 (earnings).
//
// Planned (docs/API_CONTRACT.md):
//   GET /nurses (public directory for women),
//   GET/PATCH /nurse/profile, POST /nurse/documents, POST /nurse/profile/submit,
//   GET /nurse/questions, POST /nurse/questions/:id/claim|release|answer, GET /nurse/earnings, POST /nurse/withdrawals
//
// Z3: everything under /nurse/* requires a signed-in NURSE. The guard is mounted on the prefix, so
// routes added later are protected by default. (/nurses, the public directory, is a different path.)
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export function createNursesRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(
    '/nurse',
    requireAuth({
      db: deps.db,
      jwtAccessSecret: deps.config.auth.jwtAccessSecret,
      now: deps.clock ?? (() => new Date()),
    }),
    requireRole('nurse'),
  );
  return router;
}
