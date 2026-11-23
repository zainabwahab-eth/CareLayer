import { isStandaloneDisplay } from '../../pwa/display-mode';
import { paths } from '../../routes/paths';
import { QUICK_EXIT_ATTRIBUTE, QUICK_EXIT_FLAG_KEY } from './leave-now';

/*
 * Makes sure CareLayer never comes back showing what she was looking at
 * after a quick exit: "the next open shows a blank new chat".
 *
 * - Opened again in this tab (Back, Forward, typing the address): the app
 *   starts on a blank chat instead of the screen in the URL.
 * - Restored from the back/forward cache: reloaded fresh, so nothing held in
 *   memory (the chat) survives.
 * - Installed app: leaving the app's scope opens the neutral site in an
 *   in-app browser on top of CareLayer. When she closes it and comes back, the
 *   page under it (hidden since she tapped Quick exit) reloads as a blank chat.
 *
 * Install once, before React renders (main.tsx).
 */

/** Where CareLayer reopens after a quick exit. Signed-out visitors are sent to Log in from here. */
export const QUICK_EXIT_RETURN_PATH = paths.ask;
/**
 * Installed app only: a tap on the blank page this long after leaving counts as
 * coming back (some in-app browsers close without a focus or visibility event).
 * Long enough that it never interrupts a slow trip to the neutral site.
 */
const TAP_FALLBACK_MS = 5_000;

export interface QuickExitGuardOptions {
  /** Load a fresh page at `path` (tests pass a spy). */
  reload?: (path: string) => void;
  now?: () => number;
  /** Running as the installed app (tests override). */
  standalone?: () => boolean;
}

function readFlag(): string | null {
  try {
    return window.sessionStorage.getItem(QUICK_EXIT_FLAG_KEY);
  } catch {
    return null;
  }
}

function clearFlag() {
  try {
    window.sessionStorage.removeItem(QUICK_EXIT_FLAG_KEY);
  } catch {
    // Storage blocked: nothing was stored.
  }
}

/** Returns a function that removes the listeners (tests). */
export function installQuickExitGuard(options: QuickExitGuardOptions = {}): () => void {
  const reload = options.reload ?? ((path: string) => window.location.replace(path));
  const now = options.now ?? (() => Date.now());

  // Fresh document in a tab that quick-exited: start on a blank chat. Done
  // before the router reads the URL, so the old screen never renders.
  if (readFlag() !== null) {
    clearFlag();
    if (window.location.pathname !== QUICK_EXIT_RETURN_PATH) {
      window.history.replaceState(null, '', QUICK_EXIT_RETURN_PATH);
    }
  }

  const root = document.documentElement;
  const isLeaving = () => root.hasAttribute(QUICK_EXIT_ATTRIBUTE);
  const standalone = options.standalone ?? isStandaloneDisplay;

  let reloading = false;
  const restart = () => {
    if (reloading) return;
    reloading = true;
    clearFlag();
    reload(QUICK_EXIT_RETURN_PATH);
  };

  // Any browser: the page itself came back from the back/forward cache.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted && (isLeaving() || readFlag() !== null)) restart();
  };

  // Installed app only. In a browser tab the page is on its way out, and
  // reloading here could cancel a slow trip to the neutral site.
  let leftAt: number | null = null;
  let wentAway = false;
  const observer = new MutationObserver(() => {
    if (isLeaving()) {
      leftAt ??= now();
    } else {
      leftAt = null;
      wentAway = false;
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: [QUICK_EXIT_ATTRIBUTE] });

  const onAway = () => {
    if (isLeaving() && standalone()) wentAway = true;
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onAway();
    else onBack();
  };
  const onBack = () => {
    if (isLeaving() && wentAway && standalone()) restart();
  };
  const onTap = () => {
    if (!isLeaving() || !standalone() || leftAt === null) return;
    if (now() - leftAt >= TAP_FALLBACK_MS) restart();
  };

  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onAway);
  window.addEventListener('focus', onBack);
  window.addEventListener('pointerdown', onTap, true);

  return () => {
    observer.disconnect();
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', onAway);
    window.removeEventListener('focus', onBack);
    window.removeEventListener('pointerdown', onTap, true);
  };
}
