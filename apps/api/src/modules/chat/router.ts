// Chat module (Z6). Contract: docs/API_CONTRACT.md §6-7.
//   POST /chat         woman: { messages, conversationId? } -> reply (+ price offer) | emergency,
//                      saved to her conversation (conversationId in the response)
//   GET  /chat/conversations       woman: her saved chats, most recently active first (paged)
//   GET  /chat/conversations/:id   woman: one chat's messages, oldest first
//   DELETE /chat/conversations/:id woman: delete a chat and its messages
//   POST /chat/draft   woman: { messages } -> the exact question a nurse would get, signed | emergency
//   GET  /emergency    public: the static emergency content
import { CHAT_LIMITS } from '@carelayer/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter, type RateLimiter } from '../../lib/rate-limit.js';
import { getAuth, requireAuth, requireRole } from '../auth/middleware.js';
import { emergencyResponse } from '../emergency/service.js';
import type { ConversationStore } from './conversations.js';
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
  conversationId: z.string().trim().min(1).max(64).optional(),
});

const ConversationListSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be 1-100')
    .max(100, 'limit must be 1-100')
    .default(20),
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
  conversations: ConversationStore,
  limiter: RateLimiter = createRateLimiter({
    limit: CHAT_LIMITS.requestsPerMinute,
    windowMs: 60_000,
    now: deps.clock,
  }),
): Router {
  const router = Router();
  const guard = {
    db: deps.db,
    jwtAccessSecret: deps.config.auth.jwtAccessSecret,
    now: deps.clock ?? (() => new Date()),
  };
  const authed = requireAuth(guard);
  // Claude (agent token) may draft a question; it may not use /chat (Claude is the assistant there).
  const authedOrAgent = requireAuth({
    ...guard,
    allowAgent: true,
    pepper: deps.config.auth.pepper,
  });

  router.get('/emergency', (_req, res) => {
    res.json(emergencyResponse([]));
  });

  router.post('/chat', authed, requireRole('woman'), async (req, res) => {
    const { messages, conversationId } = ChatRequestSchema.parse(req.body);
    const { userId } = getAuth(res);
    limiter.hit(userId);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await chat.reply(userId, messages, conversationId));
  });

  // Saved chats: signed-in women only (never an agent token: Claude has no access to her chats).
  router.get('/chat/conversations', authed, requireRole('woman'), async (req, res) => {
    const query = ConversationListSchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await conversations.list(getAuth(res).userId, query));
  });

  router.get('/chat/conversations/:id', authed, requireRole('woman'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await conversations.get(getAuth(res).userId, String(req.params.id)));
  });

  router.delete('/chat/conversations/:id', authed, requireRole('woman'), async (req, res) => {
    await conversations.remove(getAuth(res).userId, String(req.params.id));
    res.status(204).end();
  });

  router.post('/chat/draft', authedOrAgent, requireRole('woman'), async (req, res) => {
    const { messages } = DraftRequestSchema.parse(req.body);
    const { userId, via } = getAuth(res);
    limiter.hit(userId);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await chat.draft(userId, messages, via === 'agent' ? 'mcp' : 'web'));
  });

  return router;
}
