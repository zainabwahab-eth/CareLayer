// Questions module. Z6: create, status, her list. Z8 adds the x402 answer and feedback.
// Contract: docs/API_CONTRACT.md §8.
//   POST /questions               woman: consent + her words (+ draftToken) -> question | emergency
//   GET  /questions/:id/status    woman (own)
//   GET  /me/questions            woman: ?status=open|claimed|answered|expired|cancelled|active
//   GET  /me/questions/:id        woman (own)
// Third-party agents (X-Question-Key) and Claude (agent tokens) come with Z12.
import { CHAT_LIMITS, QUESTION_STATUSES, SHARED_FIELDS } from '@carelayer/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { getAuth, requireAuth, requireRole } from '../auth/middleware.js';
import type { QuestionService } from './service.js';

const CreateQuestionSchema = z
  .object({
    // Stored verbatim: validated, never trimmed or transformed.
    originalText: z
      .string({ error: 'Write your question.' })
      .refine((t) => t.trim().length > 0, 'Write your question.')
      .refine(
        (t) => t.length <= CHAT_LIMITS.maxQuestionLength,
        `Questions can be up to ${CHAT_LIMITS.maxQuestionLength} characters.`,
      ),
    source: z.enum(['web', 'mcp', 'agent']).default('web'),
    consent: z.object({
      sharedFields: z
        .array(z.enum(SHARED_FIELDS))
        .refine((f) => new Set(f).size === f.length, 'sharedFields has duplicates.'),
      consentVersion: z.string().trim().min(1, 'consentVersion is required.').max(50),
    }),
    nurseSelection: z.enum(['first_available', 'chosen_nurse']).default('first_available'),
    chosenNurseId: z.string().min(1).max(64).optional(),
    femaleOnly: z.boolean().optional(),
    approvedAboveLimit: z.boolean().optional(),
    draftToken: z.string().min(1).max(30_000).optional(),
  })
  .superRefine((b, ctx) => {
    if (b.nurseSelection === 'chosen_nurse' && !b.chosenNurseId) {
      ctx.addIssue({ code: 'custom', path: ['chosenNurseId'], message: 'Choose a nurse.' });
    }
    if (b.nurseSelection === 'first_available' && b.chosenNurseId) {
      ctx.addIssue({
        code: 'custom',
        path: ['chosenNurseId'],
        message: 'chosenNurseId is only used with nurseSelection "chosen_nurse".',
      });
    }
  });

const ListQuerySchema = z.object({
  status: z.enum([...QUESTION_STATUSES, 'active']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be 1-100')
    .max(100, 'limit must be 1-100')
    .default(20),
});

export function createQuestionsRouter(deps: AppDeps, questions: QuestionService): Router {
  const router = Router();
  const authed = requireAuth({
    db: deps.db,
    jwtAccessSecret: deps.config.auth.jwtAccessSecret,
    now: deps.clock ?? (() => new Date()),
  });

  router.post('/questions', authed, requireRole('woman'), async (req, res) => {
    // No consent object at all is a consent problem, not a generic validation one.
    const consent = (req.body as { consent?: unknown } | undefined)?.consent;
    if (!consent || typeof consent !== 'object') {
      throw new AppError(
        400,
        'CONSENT_REQUIRED',
        'Agree to what is shared with the nurse before sending.',
      );
    }
    const body = CreateQuestionSchema.parse(req.body);
    if (body.source !== 'web') {
      throw new AppError(400, 'VALIDATION_FAILED', 'Signed-in web requests use source "web".', {
        field: 'source',
      });
    }
    const result = await questions.create(getAuth(res).userId, body);
    res.status(result.status).json(result.body);
  });

  router.get('/questions/:id/status', authed, requireRole('woman'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await questions.status(getAuth(res).userId, String(req.params.id)));
  });

  router.get('/me/questions', authed, requireRole('woman'), async (req, res) => {
    const query = ListQuerySchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await questions.listMine(getAuth(res).userId, query));
  });

  router.get('/me/questions/:id', authed, requireRole('woman'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await questions.getMine(getAuth(res).userId, String(req.params.id)));
  });

  return router;
}
