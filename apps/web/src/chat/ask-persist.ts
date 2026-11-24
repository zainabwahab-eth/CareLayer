import type { Id } from '@carelayer/shared';
import type { AskRequest } from './ask-request';

/*
 * The W07-W09 send flow, kept in this tab (sessionStorage) so a reload on W07, W08 or W09
 * brings her back to the same step instead of an empty chat. One entry per signed-in user;
 * cleared when she sends the question, starts a new chat, signs out or uses Quick exit.
 * sessionStorage only: it never outlives the tab, and holds nothing the chat itself doesn't.
 */

const PREFIX = 'carelayer.ask.';

export interface SavedAsk {
  /** The saved chat the question comes from: reopened to bring the thread back. */
  conversationId: Id;
  offeredFor: string | null;
  request: AskRequest;
}

function keyFor(userId: Id): string {
  return `${PREFIX}${userId}`;
}

export function loadAsk(userId: Id): SavedAsk | null {
  try {
    const raw = window.sessionStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<SavedAsk>;
    if (typeof saved.conversationId !== 'string' || !saved.request?.draft) return null;
    return {
      conversationId: saved.conversationId,
      offeredFor: typeof saved.offeredFor === 'string' ? saved.offeredFor : null,
      request: saved.request,
    };
  } catch {
    return null; // blocked storage or a damaged entry: start fresh
  }
}

export function saveAsk(userId: Id, saved: SavedAsk | null): void {
  try {
    if (saved) window.sessionStorage.setItem(keyFor(userId), JSON.stringify(saved));
    else window.sessionStorage.removeItem(keyFor(userId));
  } catch {
    // Storage blocked (private mode): the flow still works, it just won't survive a reload.
  }
}

/** Forget every saved send flow in this tab (sign-out, Quick exit). */
export function clearAllAsks(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Storage blocked: nothing was saved.
  }
}
