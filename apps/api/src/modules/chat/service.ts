// Chat (Z6). Stateless: the client sends the thread, nothing about it is stored.
//
//   reply  POST /chat        fixed red flags on her new message -> LLM (Mode A) -> its own red-flag
//                            judgement -> reply, with a price offer when it suggests a nurse.
//   draft  POST /chat/draft  her messages joined verbatim -> fixed red flags -> LLM (Mode B) ->
//                            the exact question a nurse would get, signed, plus the price offer.
//
// The fixed list always runs before the LLM, so it works even when the LLM is down.
import { randomUUID } from 'node:crypto';
import {
  CHAT_LIMITS,
  type ChatResponse,
  type ChatTurn,
  type DraftResponse,
  type QuestionDraft,
} from '@carelayer/shared';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { matchRedFlags, type RedFlag } from '../emergency/red-flags.js';
import { recordEmergency } from '../emergency/service.js';
import type { Assistant } from '../llm/assistant.js';
import { llmToAppError } from '../llm/errors.js';
import { signDraftToken } from '../questions/draft-token.js';
import { offerFrom, quoteFor, type Channel } from '../questions/pricing.js';

export interface ChatServiceDeps {
  db: Db;
  config: Pick<Config, 'answerPriceKobo' | 'ngnPerUsdc'> & {
    auth: Pick<Config['auth'], 'jwtAccessSecret'>;
  };
  assistant: Assistant;
  redFlags: RedFlag[];
  logger: Logger;
  now: () => Date;
}

/** Her question for a nurse: every one of her messages, in order, word for word. */
export function questionTextFrom(turns: ChatTurn[]): string {
  return turns
    .filter((t) => t.role === 'user')
    .map((t) => t.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function createChatService(d: ChatServiceDeps) {
  return {
    async reply(womanId: string, turns: ChatTurn[]): Promise<ChatResponse> {
      const latest = turns[turns.length - 1]!;
      const flagged = matchRedFlags(d.redFlags, latest.text);
      if (flagged.length) return recordEmergency(d, 'CHAT', flagged);

      let reply;
      try {
        reply = await d.assistant.reply(turns);
      } catch (err) {
        throw llmToAppError(err);
      }
      if (reply.redFlagSuspected) return recordEmergency(d, 'CHAT', ['llm']);

      const escalationOffer =
        reply.offerEscalation && reply.suggestedCategory
          ? offerFrom(await quoteFor(d.db, d.config, womanId), reply.suggestedCategory)
          : null;
      d.logger.info('chat_reply', { offer: escalationOffer !== null, turns: turns.length });
      return {
        kind: 'reply',
        message: {
          id: `msg_${randomUUID()}`,
          role: 'assistant',
          text: reply.text,
          createdAt: d.now().toISOString(),
        },
        escalationOffer,
      };
    },

    /** `channel` "mcp": Claude via an agent token (Claude's spending limit, emergencies logged as MCP). */
    async draft(
      womanId: string,
      turns: ChatTurn[],
      channel: Channel = 'web',
    ): Promise<DraftResponse> {
      const originalText = questionTextFrom(turns);
      if (originalText.length > CHAT_LIMITS.maxQuestionLength) {
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          `Your messages are too long to send as one question (max ${CHAT_LIMITS.maxQuestionLength} characters). Start a new question with just what you want to ask.`,
          { field: 'messages' },
        );
      }
      const emergencySource = channel === 'mcp' ? 'MCP' : 'CHAT';
      const flagged = matchRedFlags(d.redFlags, originalText);
      if (flagged.length) return recordEmergency(d, emergencySource, flagged);

      let prepared;
      try {
        prepared = await d.assistant.prepareQuestion(originalText);
      } catch (err) {
        throw llmToAppError(err);
      }
      if (prepared.redFlagSuspected) return recordEmergency(d, emergencySource, ['llm']);

      const draft: QuestionDraft = {
        originalText,
        cleanedText: prepared.cleanedText,
        assistantNotes: prepared.assistantNotes,
        category: prepared.category,
        ageRange: prepared.ageRange,
        pregnancyWeeks: prepared.pregnancyWeeks,
      };
      const [quote, signed] = await Promise.all([
        quoteFor(d.db, d.config, womanId, channel),
        signDraftToken(draft, womanId, d.config.auth.jwtAccessSecret, d.now()),
      ]);
      d.logger.info('chat_draft', {
        category: draft.category,
        cleanupFellBack: prepared.cleanupFellBack,
        hasNotes: draft.assistantNotes !== null,
      });
      return {
        kind: 'draft',
        draft,
        draftToken: signed.token,
        draftExpiresAt: signed.expiresAt.toISOString(),
        offer: offerFrom(quote, draft.category),
      };
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
