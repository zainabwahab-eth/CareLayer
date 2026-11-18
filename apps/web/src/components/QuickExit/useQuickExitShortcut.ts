import { useEffect } from 'react';
import { QUICK_EXIT_SHORTCUT_WINDOW_MS, quickExit } from './quick-exit';

/** Esc twice in quick succession leaves the app (desktop shortcut shown as "Esc Esc"). */
export function useQuickExitShortcut() {
  useEffect(() => {
    let lastEscape = 0;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.repeat) return;
      const now = event.timeStamp;
      if (now - lastEscape <= QUICK_EXIT_SHORTCUT_WINDOW_MS) quickExit();
      lastEscape = now;
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
