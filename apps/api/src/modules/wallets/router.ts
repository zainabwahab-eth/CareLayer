// Wallets module.
//   GET /wallet               any signed-in user: address, status, balance (naira + USDC), free answers  (Z4)
//   GET /wallet/transactions  confirmed money movements, cursor-paged                                   (Z4)
// Later: POST /topups, GET /topups/:id, POST /webhooks/paystack (Z5).
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { getAuth, requireAuth } from '../auth/middleware.js';
import { InvalidCursorError, type WalletService } from './service.js';

const PageSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be 1-100')
    .max(100, 'limit must be 1-100')
    .default(20),
});

export function createWalletsRouter(deps: AppDeps, wallets: WalletService): Router {
  const router = Router();
  const guard = {
    db: deps.db,
    jwtAccessSecret: deps.config.auth.jwtAccessSecret,
    now: deps.clock ?? (() => new Date()),
  };
  const authed = requireAuth(guard);
  // Claude (agent token, Z12) may read her balance (get_balance). Nothing else in this module.
  const authedOrAgent = requireAuth({
    ...guard,
    allowAgent: true,
    pepper: deps.config.auth.pepper,
  });

  router.get('/wallet', authedOrAgent, async (_req, res) => {
    const user = await deps.db.user.findUniqueOrThrow({ where: { id: getAuth(res).userId } });
    res.setHeader('Cache-Control', 'no-store');
    res.json(await wallets.view(user));
  });

  router.get('/wallet/transactions', authed, async (req, res) => {
    const page = PageSchema.parse(req.query);
    const user = await deps.db.user.findUniqueOrThrow({ where: { id: getAuth(res).userId } });
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await wallets.transactions(user, page));
    } catch (err) {
      if (err instanceof InvalidCursorError) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Invalid cursor.', { field: 'cursor' });
      }
      throw err;
    }
  });

  return router;
}
