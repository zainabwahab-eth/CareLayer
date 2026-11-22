// Nurses module. Z6: the public directory. Z7 (claims), Z9 (onboarding), Z10 (earnings) add the rest.
//
//   GET /nurses?topic=&femaleOnly=   woman: approved, available nurses, public profile fields only (Z6)
// Planned (docs/API_CONTRACT.md):
//   GET/PATCH /nurse/profile, POST /nurse/documents, POST /nurse/profile/submit,
//   GET /nurse/questions, POST /nurse/questions/:id/claim|release|answer, GET /nurse/earnings, POST /nurse/withdrawals
//
// Z3: everything under /nurse/* requires a signed-in NURSE. The guard is mounted on the prefix, so
// routes added later are protected by default. (/nurses, the public directory, is a different path.)
import { QUESTION_CATEGORIES } from '@carelayer/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { listNurseDirectory } from './directory.js';

const DirectoryQuerySchema = z.object({
  topic: z.enum(QUESTION_CATEGORIES).optional(),
  femaleOnly: z
    .enum(['true', 'false', '1', '0'], { error: 'femaleOnly must be true or false' })
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export function createNursesRouter(deps: AppDeps): Router {
  const router = Router();
  const authed = requireAuth({
    db: deps.db,
    jwtAccessSecret: deps.config.auth.jwtAccessSecret,
    now: deps.clock ?? (() => new Date()),
  });

  router.get('/nurses', authed, requireRole('woman'), async (req, res) => {
    const query = DirectoryQuerySchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await listNurseDirectory(deps.db, query));
  });

  router.use('/nurse', authed, requireRole('nurse'));
  return router;
}
