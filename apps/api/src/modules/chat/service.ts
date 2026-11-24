// Chat (Z6). The client sends the thread it shows; the outcome is saved to her account
// (conversations.ts): her message + the reply, or her message alone when it raised an emergency.
//
//   reply  POST /chat        fixed red flags on her new message -> LLM (Mode A) -> its own red-flag
//                            judgement -> reply, with a price offer when it suggests a nurse.
//   draft  POST /chat/draft  fixed red flags on everything she wrote -> LLM (Mode B) picks which
//                            of her messages are the question (verbatim) and writes notes from
//                            the rest -> the exact question a nurse would get, signed, + price.
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
import type { ConversationStore, NewMessage } from './conversations.js';

export interface ChatServiceDeps {
  db: Db;
  config: Pick<Config, 'answerPriceKobo' | 'ngnPerUsdc'> & {
    auth: Pick<Config['auth'], 'jwtAccessSecret'>;
  };
  assistant: Assistant;
  conversations: ConversationStore;
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
    /** `conversationId`: add to that conversation (hers, else 404); omitted starts a new one. */
    async reply(
      womanId: string,
      turns: ChatTurn[],
      conversationId?: string,
    ): Promise<ChatResponse> {
      if (conversationId) await d.conversations.assertOwned(womanId, conversationId);
      const latest = turns[turns.length - 1]!;

      // Saving never blocks what she needs: an emergency or a reply is returned even if the save
      // fails (logged; conversationId null, the app keeps the chat it shows).
      const save = async (messages: NewMessage[]): Promise<string | null> => {
        try {
          return await d.conversations.append(womanId, conversationId, messages);
        } catch (err) {
          d.logger.error('conversation_save_failed', { error: (err as Error).message });
          return conversationId ?? null;
        }
      };

      // Emergency: her message is saved (so the chat shows it after a reload), no reply follows.
      const emergency = async (triggers: string[]): Promise<ChatResponse> => {
        const response = await recordEmergency(d, 'CHAT', triggers);
        const id = await save([{ role: 'user', text: latest.text, emergency: true }]);
        return { ...response, conversationId: id };
      };

      const flagged = matchRedFlags(d.redFlags, latest.text);
      if (flagged.length) return emergency(flagged);

      let reply;
      try {
        reply = await d.assistant.reply(turns);
      } catch (err) {
        throw llmToAppError(err); // nothing saved: "Try again" resends the same message
      }
      if (reply.redFlagSuspected) return emergency(['llm']);

      const escalationOffer =
        reply.offerEscalation && reply.suggestedCategory
          ? offerFrom(await quoteFor(d.db, d.config, womanId), reply.suggestedCategory)
          : null;
      const id = await save([
        { role: 'user', text: latest.text },
        { role: 'assistant', text: reply.text },
      ]);
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
        conversationId: id,
      };
    },

    /**
     * `channel` "mcp": Claude via an agent token (Claude's spending limit, emergencies logged as MCP).
     * `focusIndex`: her message the assistant offered a nurse for (a hint for choosing the question).
     * The question is her chosen message(s) verbatim, not the whole chat; relevant details from the
     * rest of the chat go in the assistant notes.
     */
    async draft(
      womanId: string,
      turns: ChatTurn[],
      channel: Channel = 'web',
      focusIndex?: number,
    ): Promise<DraftResponse> {
      // Safety first: the fixed red-flag list runs on everything she wrote in the chat.
      const emergencySource = channel === 'mcp' ? 'MCP' : 'CHAT';
      const flagged = matchRedFlags(d.redFlags, questionTextFrom(turns));
      if (flagged.length) return recordEmergency(d, emergencySource, flagged);

      let prepared;
      try {
        prepared = await d.assistant.prepareFromConversation(turns, focusIndex);
      } catch (err) {
        throw llmToAppError(err);
      }
      const originalText = prepared.originalText;
      if (originalText.length > CHAT_LIMITS.maxQuestionLength) {
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          `Your question is too long to send (max ${CHAT_LIMITS.maxQuestionLength} characters). Start a new question with just what you want to ask.`,
          { field: 'messages' },
        );
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
        selection: prepared.selection,
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
