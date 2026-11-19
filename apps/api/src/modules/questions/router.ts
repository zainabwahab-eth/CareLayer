// Questions module. Endpoints are built in Z6 (create, status) and Z8 (answer over x402, feedback) (docs/TASKS.md). Skeleton only: no routes yet.
//
// Planned (docs/API_CONTRACT.md):
//   POST /questions, GET /questions/:id/status, GET /questions/:id/answer (x402),
//   POST /questions/:id/feedback, GET /me/questions, GET /me/questions/:id
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';

export function createQuestionsRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
