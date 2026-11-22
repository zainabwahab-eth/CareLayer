// Chat module (Z6). Contract: docs/API_CONTRACT.md §6-7.
//   POST /chat         woman: { messages } -> reply (+ price offer) | emergency
//   POST /chat/draft   woman: { messages } -> the exact question a nurse would get, signed | emergency
//   GET  /emergency    public: the static emergency content
import { CHAT_LIMITS } from '@carelayer/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter, type RateLimiter } from '../../lib/rate-limit.js';
import { getAuth, requireAuth, requireRole } from '../auth/middleware.js';
import { emergencyResponse } from '../emergency/service.js';
import type { ChatService } from './service.js';

const Turns = z
  .array(
    z.object({
      role: z.enum(['user', 'assistant'], { error: 'role must be "user" or "assistant"' }),
      text: z
        .string({ error: 'Each message needs text.' })
        .trim()
        .min(1, 'Messages cannot be empty.')
        .max(
          CHAT_LIMITS.maxTextLength,
          `Messages can be up to ${CHAT_LIMITS.maxTextLength} characters.`,
        ),
    }),
    { error: 'messages must be a list.' },
  )
  .min(1, 'Send at least one message.')
  .max(CHAT_LIMITS.maxTurns, `Send at most the last ${CHAT_LIMITS.maxTurns} messages.`);

/** POST /chat: the last turn is her new message. */
export const ChatRequestSchema = z.object({
  messages: Turns.refine(
    (m) => m[m.length - 1]?.role === 'user',
    'The last message must be hers (role "user").',
  ),
});

/**
 * POST /chat/draft: usually called right after the assistant's offer, so the thread may end with
 * the assistant's turn. It needs at least one of her messages (her question).
 */
export const DraftRequestSchema = z.object({
  messages: Turns.refine(
    (m) => m.some((t) => t.role === 'user'),
    'Include at least one of her messages (role "user").',
  ),
});

export function createChatRouter(
  deps: AppDeps,
  chat: ChatService,
  limiter: RateLimiter = createRateLimiter({
    limit: CHAT_LIMITS.requestsPerMinute,
    windowMs: 60_000,
    now: deps.clock,
  }),
): Router {
  const router = Router();
  const authed = requireAuth({
    db: deps.db,
    jwtAccessSecret: deps.config.auth.jwtAccessSecret,
    now: deps.clock ?? (() => new Date()),
  });

  router.get('/emergency', (_req, res) => {
    res.json(emergencyResponse([]));
  });

  router.post('/chat', authed, requireRole('woman'), async (req, res) => {
    const { messages } = ChatRequestSchema.parse(req.body);
    const { userId } = getAuth(res);
    limiter.hit(userId);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await chat.reply(userId, messages));
  });

  router.post('/chat/draft', authed, requireRole('woman'), async (req, res) => {
    const { messages } = DraftRequestSchema.parse(req.body);
    const { userId } = getAuth(res);
    limiter.hit(userId);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await chat.draft(userId, messages));
  });

  return router;
}
