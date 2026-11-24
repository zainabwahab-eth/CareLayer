// Questions module. Z6: create, status, her list. Z8: the x402 answer, collect, feedback.
// Contract: docs/API_CONTRACT.md §8.
//   POST /questions                  woman: consent + her words (+ draftToken) -> question | emergency
//   GET  /questions/:id/status       woman (own)
//   GET  /questions/:id/answer       woman (own) + x402: 409/410 guard -> free | 402 | paid answer
//   POST /me/questions/:id/collect   woman: the API's agent pays from her wallet (or free)
// Claude (agent token, Z12) may use: POST /questions (source "mcp"), GET /questions/:id/status,
// POST /me/questions/:id/collect (Claude's spending limit; confirmPayment when she asked for it).
//   POST /questions/:id/feedback     woman: { helpful }
//   GET  /me/questions               woman: ?status=open|claimed|answered|expired|cancelled|active
//   GET  /me/questions/:id           woman (own)
// Third-party agents (X-Question-Key) and Claude (agent tokens) come with Z12.
import { CHAT_LIMITS, QUESTION_STATUSES, SHARED_FIELDS } from '@carelayer/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { getAuth, requireAuth, requireRole } from '../auth/middleware.js';
import type { AnswerService } from './answers.js';
import type { ConversationStore } from '../chat/conversations.js';
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
    conversationId: z.string().trim().min(1).max(64).optional(),
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

const CollectSchema = z
  .object({ approvedAboveLimit: z.boolean().optional(), confirmPayment: z.boolean().optional() })
  .strict();
const FeedbackSchema = z.object({
  helpful: z.boolean({ error: 'helpful must be true or false.' }),
});

export function createQuestionsRouter(
  deps: AppDeps,
  questions: QuestionService,
  answers: AnswerService,
  /** Links a question to the chat it was sent from (optional in tests). */
  conversations?: ConversationStore,
): Router {
  const router = Router();
  const guard = {
    db: deps.db,
    jwtAccessSecret: deps.config.auth.jwtAccessSecret,
    now: deps.clock ?? (() => new Date()),
  };
  const authed = requireAuth(guard);
  // Claude (agent token, Z12) may send a question, check its status and collect the answer.
  const authedOrAgent = requireAuth({
    ...guard,
    allowAgent: true,
    pepper: deps.config.auth.pepper,
  });

  router.post('/questions', authedOrAgent, requireRole('woman'), async (req, res) => {
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
    const { userId, via } = getAuth(res);
    // The source is who is asking: her app ("web") or Claude with her agent token ("mcp").
    const expected = via === 'agent' ? 'mcp' : 'web';
    if (body.source !== expected) {
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        via === 'agent'
          ? 'Claude sends questions with source "mcp".'
          : 'Signed-in web requests use source "web".',
        { field: 'source' },
      );
    }
    const result = await questions.create(userId, body, expected);
    // Show it in the chat she asked from. Best effort: never fails the question.
    if (result.status === 201 && body.conversationId && conversations) {
      await conversations
        .linkQuestion(userId, body.conversationId, result.body.id)
        .catch((err: unknown) =>
          deps.logger.warn('conversation_link_failed', { error: (err as Error).message }),
        );
    }
    res.status(result.status).json(result.body);
  });

  router.get('/questions/:id/status', authedOrAgent, requireRole('woman'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await questions.status(getAuth(res).userId, String(req.params.id)));
  });

  // x402 (manual flow, see modules/payments/answer-x402.ts). PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1).
  router.get('/questions/:id/answer', authed, requireRole('woman'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const header = req.get('payment-signature') ?? req.get('x-payment') ?? undefined;
    const result = await answers.fetchAnswer(getAuth(res).userId, String(req.params.id), header);
    if (result.kind === 'payment_required') {
      res.setHeader('PAYMENT-REQUIRED', result.paymentRequiredHeader);
      res.status(402).json(result.body);
      return;
    }
    if (result.paymentResponseHeader) {
      res.setHeader('PAYMENT-RESPONSE', result.paymentResponseHeader);
      res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-RESPONSE');
    }
    res.json(result.body);
  });

  router.post(
    '/me/questions/:id/collect',
    authedOrAgent,
    requireRole('woman'),
    async (req, res) => {
      const body = CollectSchema.parse(req.body ?? {});
      const { userId, via } = getAuth(res);
      res.setHeader('Cache-Control', 'no-store');
      res.json(
        await answers.collect(userId, String(req.params.id), {
          ...body,
          channel: via === 'agent' ? 'mcp' : 'web',
        }),
      );
    },
  );

  router.post('/questions/:id/feedback', authed, requireRole('woman'), async (req, res) => {
    const { helpful } = FeedbackSchema.parse(req.body ?? {});
    res.json(await answers.feedback(getAuth(res).userId, String(req.params.id), helpful));
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
