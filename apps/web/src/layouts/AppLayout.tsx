import { FREE_ANSWERS_PER_WOMAN } from '@carelayer/shared';
import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { useApiQuery } from '../api/useApiQuery';
import { isSessionError } from '../auth/auth-flow';
import { useAuth } from '../auth/useAuth';
import { cx } from '../components/cx';
import { BalanceCard, Sidebar } from '../components/navigation/Sidebar';
import { TabBar } from '../components/navigation/TabBar';
import { paths } from '../routes/paths';
import { useRouteHandle } from '../routes/route-handle';
import { formatNaira } from '../utils/money';
import styles from './AppLayout.module.css';

/*
 * Authenticated shell.
 *   Mobile  (< 960px): full-width content; bottom tab bar on Home, History and Account.
 *   Desktop (>= 960px): 264px sidebar + main column (Figma: Women - Desktop, 1440 frame).
 */
export function AppLayout() {
  const { nav, tabBar = false } = useRouteHandle();
  // RequireAuth guarantees a signed-in user here; the sign-in response carries her profile.
  const { state, sessionExpired } = useAuth();
  const user = state.user;
  // Sidebar balance. Hidden until loaded.
  const wallet = useApiQuery((api) => api.wallet.get());

  // If the session has ended on the server, RequireAuth sends her to Log in.
  useEffect(() => {
    if (wallet.status === 'error' && isSessionError(wallet.error)) sessionExpired();
  }, [wallet.status, wallet.error, sessionExpired]);

  return (
    <div className={styles.shell}>
      <Sidebar
        className={styles.sidebar}
        active={nav}
        user={user ? { name: user.displayName, email: user.email } : undefined}
        balance={
          wallet.data && (
            <BalanceCard
              amount={formatNaira(wallet.data.balance)}
              note={
                wallet.data.freeAnswersRemaining === null
                  ? undefined
                  : `${wallet.data.freeAnswersRemaining} of ${FREE_ANSWERS_PER_WOMAN} free answers left`
              }
              topUpTo={paths.account}
            />
          )
        }
      />
      <main
        id="main-content"
        tabIndex={-1}
        className={cx(styles.main, tabBar && styles.withTabBar)}
      >
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
      {tabBar && <TabBar active={nav} className={styles.tabBar} />}
    </div>
  );
}
