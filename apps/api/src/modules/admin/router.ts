// Admin module (Z9). Contract: docs/API_CONTRACT.md §11.
//   GET  /admin/nurses?status=pending_review   list (oldest first, cursor pages)
//   GET  /admin/nurses/:id                     profile + email + signed 10-minute document links
//   POST /admin/nurses/:id/approve
//   POST /admin/nurses/:id/reject              { reason }
//   GET  /admin-console                        minimal admin page (public HTML; data needs an admin)
//
// Z3: everything under /admin/* requires a signed-in ADMIN (guard on the prefix).
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { getAuth, requireAuth, requireRole } from '../auth/middleware.js';
import { adminConsoleHtml, adminConsoleNonce } from './console.js';
import type { AdminService } from './service.js';

const ListSchema = z.object({
  status: z.enum(['draft', 'pending_review', 'approved', 'rejected']).default('pending_review'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be 1-100')
    .max(100, 'limit must be 1-100')
    .default(20),
});

const RejectSchema = z
  .object({
    reason: z
      .string({ error: 'Give a reason the nurse can act on.' })
      .trim()
      .min(5, 'Give a reason the nurse can act on.')
      .max(500, 'Keep the reason under 500 characters.'),
  })
  .strict();

export function createAdminRouter(deps: AppDeps, admin: AdminService): Router {
  const router = Router();

  // The page itself holds no data: it signs in through /auth (app "admin") and calls /admin/*.
  router.get('/admin-console', (_req, res) => {
    const nonce = adminConsoleNonce();
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.send(adminConsoleHtml(nonce));
  });

  router.use(
    '/admin',
    requireAuth({
      db: deps.db,
      jwtAccessSecret: deps.config.auth.jwtAccessSecret,
      now: deps.clock ?? (() => new Date()),
    }),
    requireRole('admin'),
  );

  router.get('/admin/nurses', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await admin.list(ListSchema.parse(req.query)));
  });

  router.get('/admin/nurses/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await admin.detail(getAuth(res).userId, String(req.params.id)));
  });

  router.post('/admin/nurses/:id/approve', async (req, res) => {
    res.json(await admin.approve(getAuth(res).userId, String(req.params.id)));
  });

  router.post('/admin/nurses/:id/reject', async (req, res) => {
    const { reason } = RejectSchema.parse(req.body);
    res.json(await admin.reject(getAuth(res).userId, String(req.params.id), reason));
  });

  return router;
}
