// Users module.
//   GET   /me    the signed-in user (any role)          (Z3)
//   PATCH /me    { displayName }                         (Z3)
// Later: GET/PATCH /me/settings, GET/PATCH /me/notifications (Z6/H7).
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { getAuth, requireAuth } from '../auth/middleware.js';
import { toUserDto } from './dto.js';

const UpdateMeSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Use between 1 and 100 characters.')
    .max(100, 'Use between 1 and 100 characters.')
    .optional(),
});

export function createUsersRouter(deps: AppDeps): Router {
  const router = Router();
  const authed = requireAuth({
    db: deps.db,
    jwtAccessSecret: deps.config.auth.jwtAccessSecret,
    now: deps.clock ?? (() => new Date()),
  });

  router.get('/me', authed, async (_req, res) => {
    const user = await deps.db.user.findUniqueOrThrow({ where: { id: getAuth(res).userId } });
    res.json(toUserDto(user));
  });

  router.patch('/me', authed, async (req, res) => {
    const body = UpdateMeSchema.parse(req.body);
    const user = await deps.db.user.update({
      where: { id: getAuth(res).userId },
      data: body.displayName ? { displayName: body.displayName } : {},
    });
    res.json(toUserDto(user));
  });

  return router;
}
