// Saved chats (decision changed 2026-11-24: chat history is kept in her account).
//
//   POST /chat saves her new message and the reply (or her message alone when it raised an
//   emergency) in a conversation, only once the outcome is known: a failed LLM call saves nothing,
//   so "Try again" never duplicates a message.
//   GET /chat/conversations, GET /chat/conversations/:id, DELETE /chat/conversations/:id.
//
// A conversation is hers only: another woman's id is 404, nurses and agent tokens never reach these
// routes. Deleting a conversation deletes its messages (cascade).
import type {
  ChatRole,
  Conversation,
  ConversationMessage,
  ConversationSummary,
  Page,
} from '@carelayer/shared';
import type { Db } from '../../db.js';
import { AppError } from '../../lib/errors.js';

/** Longest title / preview kept for the History list. */
export const TITLE_LENGTH = 80;
export const PREVIEW_LENGTH = 120;

/** The start of a message, cut at a word where possible: "My period is late and…". */
export function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export interface NewMessage {
  role: ChatRole;
  text: string;
  emergency?: boolean;
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Chat not found.');

function parseCursor(cursor: string): { updatedAt: Date; id: string } | null {
  const [at, id] = cursor.split('|');
  const updatedAt = new Date(at ?? '');
  if (!id || Number.isNaN(updatedAt.getTime())) return null;
  return { updatedAt, id };
}

const toRole = (role: 'USER' | 'ASSISTANT'): ChatRole => (role === 'USER' ? 'user' : 'assistant');

export function createConversationStore(d: { db: Db; now: () => Date }) {
  return {
    /** Throws 404 unless the conversation exists and is hers. */
    async assertOwned(womanId: string, id: string): Promise<void> {
      const found = await d.db.conversation.findFirst({
        where: { id, womanId },
        select: { id: true },
      });
      if (!found) throw notFound();
    },

    /**
     * Adds messages (in order) to her conversation, creating it when `id` is undefined.
     * Returns the conversation id.
     */
    async append(womanId: string, id: string | undefined, messages: NewMessage[]): Promise<string> {
      // Explicit, increasing timestamps keep her message before the reply when both are saved at once.
      const start = d.now().getTime();
      const rows = messages.map((m, i) => ({
        role: m.role === 'user' ? ('USER' as const) : ('ASSISTANT' as const),
        text: m.text,
        emergency: m.emergency ?? false,
        createdAt: new Date(start + i),
      }));
      if (id) {
        const updated = await d.db.conversation.updateMany({
          where: { id, womanId },
          data: { updatedAt: new Date(start + rows.length) },
        });
        if (updated.count === 0) throw notFound();
        await d.db.conversationMessage.createMany({
          data: rows.map((r) => ({ ...r, conversationId: id })),
        });
        return id;
      }
      const first = messages.find((m) => m.role === 'user') ?? messages[0];
      const created = await d.db.conversation.create({
        data: {
          womanId,
          title: excerpt(first?.text ?? 'New chat', TITLE_LENGTH),
          createdAt: new Date(start),
          updatedAt: new Date(start + rows.length),
          messages: { create: rows },
        },
        select: { id: true },
      });
      return created.id;
    },

    async list(
      womanId: string,
      query: { cursor?: string; limit: number },
    ): Promise<Page<ConversationSummary>> {
      const after = query.cursor ? parseCursor(query.cursor) : null;
      if (query.cursor && !after) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Invalid cursor.', { field: 'cursor' });
      }
      const rows = await d.db.conversation.findMany({
        where: {
          womanId,
          ...(after
            ? {
                OR: [
                  { updatedAt: { lt: after.updatedAt } },
                  { updatedAt: after.updatedAt, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        include: {
          _count: { select: { messages: true } },
          messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
        },
      });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((c) => ({
          id: c.id,
          title: c.title,
          preview: excerpt(c.messages[0]?.text ?? '', PREVIEW_LENGTH),
          messageCount: c._count.messages,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
        nextCursor:
          rows.length > query.limit && last ? `${last.updatedAt.toISOString()}|${last.id}` : null,
      };
    },

    async get(womanId: string, id: string): Promise<Conversation> {
      const c = await d.db.conversation.findFirst({
        where: { id, womanId },
        include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      });
      if (!c) throw notFound();
      return {
        id: c.id,
        title: c.title,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        messages: c.messages.map((m): ConversationMessage => ({
          id: m.id,
          role: toRole(m.role),
          text: m.text,
          emergency: m.emergency,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },

    async remove(womanId: string, id: string): Promise<void> {
      const deleted = await d.db.conversation.deleteMany({ where: { id, womanId } });
      if (deleted.count === 0) throw notFound();
    },
  };
}

export type ConversationStore = ReturnType<typeof createConversationStore>;
