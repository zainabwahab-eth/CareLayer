// Auth module. Endpoints are built in Z3 (docs/TASKS.md). Skeleton only: no routes yet.
//
// Planned (route names from the docs/TASKS.md screen map; the contract still says
// /auth/code/request and /auth/code/verify: reconcile in Z3):
//   POST /auth/code, POST /auth/verify, POST /auth/google, POST /auth/refresh,
//   POST /auth/logout, POST /auth/logout-all, GET /auth/sessions, POST /auth/agent-tokens
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';

export function createAuthRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
