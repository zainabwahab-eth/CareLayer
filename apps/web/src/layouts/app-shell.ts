import { useOutletContext } from 'react-router';

/**
 * What AppLayout shares with the screens inside it (react-router outlet context).
 * `refreshWallet` reloads the sidebar balance after money moves (a top-up lands,
 * an answer is paid), so the desktop sidebar never shows a stale balance.
 */
export interface AppShellContext {
  refreshWallet: () => void;
}

export function useAppShell(): AppShellContext {
  return useOutletContext<AppShellContext>();
}
