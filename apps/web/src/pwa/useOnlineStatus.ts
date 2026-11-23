import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/**
 * The browser's view of the connection. `navigator.onLine === false` is reliable
 * (no network at all); `true` can still mean a captive or very weak network, so
 * screens keep handling failed requests themselves.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.navigator.onLine,
    () => true,
  );
}
