import { QUICK_EXIT_URLS, type QuickExitTarget } from '@carelayer/shared';

/*
 * Quick exit: "one tap away on every women's screen" (Figma principles).
 * Replaces the current history entry so Back does not return to CareLayer.
 * On desktop, pressing Esc twice does the same.
 *
 * Where it goes is her "Quick exit opens" setting (Google by default). The
 * setting is saved with her account (PATCH /me/settings) and also on this
 * device, because quick exit must work instantly: before sign-in, offline,
 * and without waiting for the API.
 */
export const QUICK_EXIT_STORAGE_KEY = 'carelayer.quickExit';
export const QUICK_EXIT_SHORTCUT_WINDOW_MS = 600;
const DEFAULT_TARGET: QuickExitTarget = 'google';

function isQuickExitTarget(value: unknown): value is QuickExitTarget {
  return typeof value === 'string' && Object.hasOwn(QUICK_EXIT_URLS, value);
}

/** The saved target on this device, or Google. Never throws. */
export function readQuickExitTarget(): QuickExitTarget {
  try {
    const stored = window.localStorage.getItem(QUICK_EXIT_STORAGE_KEY);
    if (isQuickExitTarget(stored)) return stored;
  } catch {
    // Storage blocked (private mode): fall back to the default.
  }
  return DEFAULT_TARGET;
}

/** Remember the target on this device. Returns false if storage is unavailable. */
export function storeQuickExitTarget(target: QuickExitTarget): boolean {
  try {
    window.localStorage.setItem(QUICK_EXIT_STORAGE_KEY, target);
    return true;
  } catch {
    return false;
  }
}

/** Leave now. Takes no arguments so it can be used directly as an onClick handler. */
export function quickExit() {
  window.location.replace(QUICK_EXIT_URLS[readQuickExitTarget()]);
}
