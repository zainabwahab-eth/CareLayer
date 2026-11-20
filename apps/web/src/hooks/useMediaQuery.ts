import { useCallback, useSyncExternalStore } from 'react';

/** Desktop layout from 960px: the same breakpoint as AppLayout's sidebar. */
export const DESKTOP_QUERY = '(min-width: 60rem)';

/** True while `query` matches. Re-renders when it changes (rotation, window resize). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
