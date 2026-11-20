// Users module.
//   GET   /me                 the signed-in user (any role)                       (Z3)
//   PATCH /me                 { displayName }                                      (Z3)
//   GET   /me/settings        any role                                             (settings)
//   PATCH /me/settings        any subset; nurses and admins: appearance only       (settings)
//   GET   /me/notifications   women: { notifyWhenAnswered }                        (settings)
//   PATCH /me/notifications   women                                                (settings)
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { getAuth, requireAuth, requireRole } from '../auth/middleware.js';
import { toUserDto } from './dto.js';
import {
  forbiddenSettingsFor,
  getNotifications,
  getSettings,
  UpdateNotificationsSchema,
  UpdateSettingsSchema,
  updateNotifications,
  updateSettings,
} from './settings.js';

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

  router.get('/me/settings', authed, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getSettings(deps.db, getAuth(res).userId));
  });

  router.patch('/me/settings', authed, async (req, res) => {
    const { userId, role } = getAuth(res);
    const body = UpdateSettingsSchema.parse(req.body);
    const forbidden = forbiddenSettingsFor(role, body);
    if (forbidden.length) {
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        'Only appearance can be changed on this account.',
        {
          field: forbidden[0],
        },
      );
    }
    res.json(await updateSettings(deps.db, userId, body));
  });

  router.get('/me/notifications', authed, requireRole('woman'), async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getNotifications(deps.db, getAuth(res).userId));
  });

  router.patch('/me/notifications', authed, requireRole('woman'), async (req, res) => {
    const body = UpdateNotificationsSchema.parse(req.body);
    res.json(await updateNotifications(deps.db, getAuth(res).userId, body));
  });

  return router;
}
