import { useMatches } from 'react-router';
import type { NavKey } from '../components/navigation/nav-items';

/**
 * Per-route shell configuration, set with `handle` in the router.
 *   nav    - which primary destination is highlighted (tab bar + sidebar)
 *   tabBar - show the mobile tab bar (Figma: only Home, History and Account have it;
 *            flow screens use a top bar instead)
 *   fullBleed - the screen owns its padding and height (W06 chat: sticky composer
 *            on mobile, chat column + context rail filling the window on desktop)
 */
export interface RouteHandle {
  nav?: NavKey;
  tabBar?: boolean;
  fullBleed?: boolean;
}

/** Merge handles from the matched route tree; the deepest route wins. */
export function useRouteHandle(): RouteHandle {
  const matches = useMatches();
  return matches.reduce<RouteHandle>(
    (merged, match) => ({ ...merged, ...((match.handle as RouteHandle | undefined) ?? {}) }),
    {},
  );
}
