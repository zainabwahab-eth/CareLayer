import { FREE_ANSWERS_PER_WOMAN } from '@carelayer/shared';
import { Outlet } from 'react-router';
import { useApiQuery } from '../api/useApiQuery';
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
  // Sidebar profile and balance. Hidden until loaded; errors are handled by the auth phase.
  const me = useApiQuery((api) => api.me.get());
  const wallet = useApiQuery((api) => api.wallet.get());

  return (
    <div className={styles.shell}>
      <Sidebar
        className={styles.sidebar}
        active={nav}
        user={me.data && { name: me.data.displayName, email: me.data.email }}
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
