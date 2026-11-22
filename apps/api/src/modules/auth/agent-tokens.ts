// Agent tokens (Z12): how Claude (apps/mcp) acts for a woman. Contract: docs/API_CONTRACT.md §3, §13.
//
// - Created and revoked only from a signed-in session (an agent token cannot mint or list tokens).
// - "clat_" + 256 random bits. Shown once; only HMAC(AUTH_PEPPER) is stored, like refresh tokens.
// - Accepted ONLY on routes that opt in (requireAuth allowAgent). Everything else answers 403, so
//   Claude can never change settings, manage tokens, or reach nurse/admin routes.
// - At most MAX_AGENT_TOKENS active per woman. Revoking is immediate.
import {
  AGENT_TOKEN_PREFIX,
  MAX_AGENT_TOKENS,
  type AgentTokenSummary,
  type CreateAgentTokenResponse,
} from '@carelayer/shared';
import type { Db } from '../../db.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { generateOpaqueToken, keyedHash } from './crypto.js';
import type { AuthState } from './middleware.js';

/** lastUsedAt is written at most this often (a write per request would be wasteful). */
const LAST_USED_RESOLUTION_MS = 60_000;

const hashOf = (pepper: string, token: string) => keyedHash(pepper, 'agent-token', token);

/** The woman behind an agent token, or null (unknown, revoked, or not a woman's account). */
export async function resolveAgentToken(
  db: Db,
  pepper: string,
  token: string,
  now: Date,
): Promise<AuthState | null> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX) || token.length > 200) return null;
  const row = await db.agentToken.findUnique({
    where: { tokenHash: hashOf(pepper, token) },
    include: { user: { select: { id: true, role: true } } },
  });
  if (!row || row.revokedAt || row.user.role !== 'WOMAN') return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await db.agentToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  }
  return {
    userId: row.userId,
    role: 'woman',
    via: 'agent',
    sessionId: '',
    stepUpAt: null,
    agentTokenId: row.id,
  };
}

export function createAgentTokenService(d: {
  db: Db;
  pepper: string;
  logger: Logger;
  now: () => Date;
}) {
  const summary = (t: {
    id: string;
    label: string;
    createdAt: Date;
    lastUsedAt: Date | null;
  }): AgentTokenSummary => ({
    id: t.id,
    label: t.label,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
  });

  return {
    async create(womanId: string, label: string): Promise<CreateAgentTokenResponse> {
      const active = await d.db.agentToken.count({ where: { userId: womanId, revokedAt: null } });
      if (active >= MAX_AGENT_TOKENS) {
        throw new AppError(
          409,
          'CONFLICT',
          `You can have ${MAX_AGENT_TOKENS} Claude connections. Remove one first.`,
        );
      }
      const token = `${AGENT_TOKEN_PREFIX}${generateOpaqueToken()}`;
      const row = await d.db.agentToken.create({
        data: {
          userId: womanId,
          label,
          tokenHash: hashOf(d.pepper, token),
          createdAt: d.now(),
        },
      });
      d.logger.info('agent_token_created', { userId: womanId, agentTokenId: row.id });
      return { id: row.id, label: row.label, token, createdAt: row.createdAt.toISOString() };
    },

    async list(womanId: string): Promise<AgentTokenSummary[]> {
      const rows = await d.db.agentToken.findMany({
        where: { userId: womanId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(summary);
    },

    async revoke(womanId: string, id: string): Promise<void> {
      const done = await d.db.agentToken.updateMany({
        where: { id, userId: womanId, revokedAt: null },
        data: { revokedAt: d.now() },
      });
      if (done.count === 0) throw new AppError(404, 'NOT_FOUND', 'Connection not found.');
      d.logger.info('agent_token_revoked', { userId: womanId, agentTokenId: id });
    },
  };
}

export type AgentTokenService = ReturnType<typeof createAgentTokenService>;
