// Top-ups module (Z5). Contract: docs/API_CONTRACT.md §5.
//   POST /topups              woman: { amountKobo } -> { topupId, reference, authorizationUrl }
//   GET  /topups/:id          woman (own): status, brought up to date with Paystack and Stellar
//   POST /webhooks/paystack   Paystack, signed (x-paystack-signature). Raw body: see app.ts.
import { TOPUP_LIMITS_KOBO } from '@carelayer/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { getAuth, requireAuth, requireRole } from '../auth/middleware.js';
import { isValidPaystackSignature } from './paystack.js';
import type { TopupService } from './service.js';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

const CreateTopupSchema = z.object({
  amountKobo: z
    .number({ error: 'Enter an amount.' })
    .int('Enter a whole amount.')
    .min(TOPUP_LIMITS_KOBO.min, `The smallest top-up is ${naira(TOPUP_LIMITS_KOBO.min)}.`)
    .max(TOPUP_LIMITS_KOBO.max, `The largest top-up is ${naira(TOPUP_LIMITS_KOBO.max)}.`),
});

const WebhookSchema = z.object({
  event: z.string(),
  data: z
    .object({
      reference: z.string(),
      amount: z.number(),
      currency: z.string(),
      paid_at: z.string().nullable().optional(),
    })
    .passthrough(),
});

export function createTopupsRouter(deps: AppDeps, topups: TopupService): Router {
  const router = Router();
  const authed = requireAuth({
    db: deps.db,
    jwtAccessSecret: deps.config.auth.jwtAccessSecret,
    now: deps.clock ?? (() => new Date()),
  });

  router.post('/topups', authed, requireRole('woman'), async (req, res) => {
    const { amountKobo } = CreateTopupSchema.parse(req.body);
    const woman = await deps.db.user.findUniqueOrThrow({ where: { id: getAuth(res).userId } });
    res.status(201).json(await topups.create(woman, amountKobo));
  });

  router.get('/topups/:id', authed, requireRole('woman'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await topups.get(getAuth(res).userId, String(req.params.id)));
  });

  router.post('/webhooks/paystack', async (req, res) => {
    const secret = deps.config.paystack.secretKey;
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!secret || !isValidPaystackSignature(raw, req.get('x-paystack-signature'), secret)) {
      throw new AppError(401, 'PAYSTACK_SIGNATURE_INVALID', 'Invalid signature.');
    }
    let event: z.infer<typeof WebhookSchema>;
    try {
      event = WebhookSchema.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      // Signed but not a shape we handle: acknowledge so Paystack does not retry forever.
      res.json({ received: true });
      return;
    }
    if (event.event === 'charge.success') {
      const topup = await topups.markPaid(
        event.data.reference,
        {
          amountKobo: event.data.amount,
          currency: event.data.currency,
          paidAt: event.data.paid_at ? new Date(event.data.paid_at) : null,
        },
        'webhook',
      );
      // Answer Paystack fast; the Stellar credit runs after the response.
      if (topup?.status === 'SUBMITTED') {
        void topups
          .credit(topup.id)
          .catch((err) =>
            deps.logger.error('topup_credit_crashed', {
              topupId: topup.id,
              error: (err as Error).message,
            }),
          );
      }
    }
    res.json({ received: true });
  });

  return router;
}
