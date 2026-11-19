// Nurses module. Endpoints are built in Z6 (directory), Z7 (claims), Z9 (onboarding), Z10 (earnings) (docs/TASKS.md). Skeleton only: no routes yet.
//
// Planned (docs/API_CONTRACT.md):
//   GET /nurses, GET/PATCH /nurse/profile, POST /nurse/documents, POST /nurse/profile/submit,
//   GET /nurse/questions, POST /nurse/questions/:id/claim|release|answer, GET /nurse/earnings, POST /nurse/withdrawals
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';

export function createNursesRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
