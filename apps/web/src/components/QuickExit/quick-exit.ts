/*
 * Quick exit: "one tap away on every women's screen" (Figma principles).
 * Replaces the current history entry so Back does not return to CareLayer.
 * On desktop, pressing Esc twice does the same.
 */
export const QUICK_EXIT_URL = 'https://www.google.com/';
export const QUICK_EXIT_SHORTCUT_WINDOW_MS = 600;

export function quickExit() {
  window.location.replace(QUICK_EXIT_URL);
}
