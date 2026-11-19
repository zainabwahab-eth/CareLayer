// Chat module. Endpoints are built in Z6 (docs/TASKS.md). Skeleton only: no routes yet.
//
// Planned (docs/API_CONTRACT.md):
//   POST /chat (red-flag check first; nothing stored server-side), GET /emergency
import { Router } from 'express';
import type { AppDeps } from '../../deps.js';

export function createChatRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
