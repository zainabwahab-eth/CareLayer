import { clearAllAsks } from '../../chat/ask-persist';
import { quickExit } from './quick-exit';

/*
 * The full quick-exit sequence (docs/TASKS.md §2 "Privacy and safety UI").
 * Every quick-exit control calls this, never quickExit() directly:
 *
 *   1. Hide the page at once, before anything else can paint. If the browser
 *      keeps this page in its back/forward cache, or takes an app-switcher
 *      snapshot, it is a blank page.
 *   2. Leave a mark for this tab (sessionStorage) so that if anything brings
 *      CareLayer back, it starts on a blank new chat (see quick-exit-guard.ts).
 *   3. Step back to the first CareLayer entry in this tab's history, then
 *      replace it with the neutral site. location.replace() alone only swaps the
 *      current entry: Back would still reach /ask, /consultations/... and so on.
 *
 * quickExit() (quick-exit.ts) picks the neutral site and does the replace.
 * Does not log out (the session cookie is untouched).
 */

export const QUICK_EXIT_FLAG_KEY = 'carelayer.quickExit.left';
/** Attribute on <html> while leaving; global.css hides the page while it is set. */
export const QUICK_EXIT_ATTRIBUTE = 'data-quick-exit';
/** Longest wait for the history step before leaving anyway. */
export const HISTORY_STEP_TIMEOUT_MS = 150;

/** How many in-app entries sit before this one (react-router keeps `idx` in history.state). */
function stepsBackToFirstEntry(): number {
  const state: unknown = window.history.state;
  if (state && typeof state === 'object' && 'idx' in state) {
    const idx = (state as { idx: unknown }).idx;
    if (typeof idx === 'number' && Number.isInteger(idx) && idx > 0) return idx;
  }
  return 0;
}

export function markQuickExit() {
  // Her unsent question must not come back if this tab is reloaded.
  clearAllAsks();
  try {
    window.sessionStorage.setItem(QUICK_EXIT_FLAG_KEY, String(Date.now()));
  } catch {
    // Storage blocked (private mode). Hiding and replacing still happen.
  }
}

/** Leave CareLayer now. Takes no arguments so it can be an onClick handler. */
export function leaveNow() {
  const root = document.documentElement;
  if (root.hasAttribute(QUICK_EXIT_ATTRIBUTE)) {
    // Already on the way out (e.g. a second tap): go straight there.
    quickExit();
    return;
  }
  root.setAttribute(QUICK_EXIT_ATTRIBUTE, '');
  markQuickExit();

  const steps = stepsBackToFirstEntry();
  if (steps === 0) {
    quickExit();
    return;
  }

  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    window.removeEventListener('popstate', leave);
    window.clearTimeout(timer);
    quickExit();
  };
  window.addEventListener('popstate', leave);
  // Never wait long: if the step back is slow or blocked, leave from here.
  const timer = window.setTimeout(leave, HISTORY_STEP_TIMEOUT_MS);
  window.history.go(-steps);
}
