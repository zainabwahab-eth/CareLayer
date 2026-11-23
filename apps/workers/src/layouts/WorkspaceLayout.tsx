import type { IconName } from '@web/components/Icon/icons';
import { Avatar } from '@web/components/Avatar/Avatar';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import { Logo } from '@web/components/Logo/Logo';
import sidebar from '@web/components/navigation/Sidebar.module.css';
import tabBar from '@web/components/navigation/TabBar.module.css';
import { Link, matchPath, Outlet, useLocation } from 'react-router';
import { useReadyProfile } from '../onboarding/profile-context';
import { paths } from '../routes/paths';
import { roleLabel } from '../workspace/format';
import { activeSection, type WorkspaceNavKey } from './workspace-nav';
import styles from './WorkspaceLayout.module.css';

/*
 * The approved nurse's workspace shell (Figma: Nurse -mobile tab bar
 * Today / Cases / Earnings / Profile; Nurse — Desktop sidebar).
 *   Mobile  (< 960px): bottom tab bar on the main screens. Focused screens
 *                      (answering, withdrawing) hide it, as N07 does.
 *   Desktop (>= 960px): sidebar with every section.
 * Uses apps/web's navigation styles, with the nurse sections and a
 * "Health worker" label so it reads as a separate workspace.
 */

interface NavItem {
  key: WorkspaceNavKey;
  label: string;
  to: string;
  icon: IconName;
}

const sidebarItems: readonly NavItem[] = [
  { key: 'today', label: 'Today', to: paths.today, icon: 'home' },
  { key: 'available', label: 'Available questions', to: paths.cases, icon: 'chat' },
  { key: 'mine', label: 'My questions', to: `${paths.cases}?tab=active`, icon: 'clock' },
  { key: 'earnings', label: 'Earnings', to: paths.earnings, icon: 'wallet' },
  { key: 'updates', label: 'Updates', to: paths.updates, icon: 'bell' },
  { key: 'profile', label: 'Profile', to: paths.profile, icon: 'user' },
  { key: 'settings', label: 'Settings', to: paths.settings, icon: 'lock' },
];

/** Figma's four mobile tabs. Updates and Settings are reached from Today and Profile. */
const tabItems: readonly NavItem[] = [
  { key: 'today', label: 'Today', to: paths.today, icon: 'home' },
  { key: 'available', label: 'Cases', to: paths.cases, icon: 'chat' },
  { key: 'earnings', label: 'Earnings', to: paths.earnings, icon: 'wallet' },
  { key: 'profile', label: 'Profile', to: paths.profile, icon: 'user' },
];

/** Focused screens: no tab bar on mobile (N07 Respond, N08, withdraw). */
function isFocused(pathname: string): boolean {
  return (
    matchPath(paths.case, pathname) !== null ||
    matchPath(paths.caseSent, pathname) !== null ||
    pathname === paths.withdraw
  );
}

export function WorkspaceLayout() {
  const { profile } = useReadyProfile();
  const location = useLocation();
  const active = activeSection(location.pathname, location.search);
  const showTabs = !isFocused(location.pathname);
  // Both "Cases" tab states highlight the Cases tab on mobile.
  const tabActive = active === 'mine' ? 'available' : active;

  return (
    <div className={styles.shell}>
      <aside className={cx(sidebar.sidebar, styles.sidebar)} aria-label="Sidebar">
        <Link to={paths.today} className={sidebar.brand} aria-label="CareLayer for health workers">
          <Logo />
        </Link>
        <p className={styles.workspaceLabel}>Health worker workspace</p>
        <nav aria-label="Main" className={sidebar.nav}>
          <ul role="list" className={sidebar.navList}>
            {sidebarItems.map((item) => {
              const isActive = item.key === active;
              return (
                <li key={item.key}>
                  <Link
                    to={item.to}
                    className={cx(sidebar.navItem, isActive && sidebar.navItemActive)}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon name={item.icon} size={22} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className={sidebar.footer}>
          <Link to={paths.profile} className={cx(sidebar.profile, styles.profileLink)}>
            <Avatar name={profile.fullName} size={36} decorative />
            <span className={sidebar.who}>
              <span className={sidebar.name}>{profile.fullName}</span>
              <span className={sidebar.email}>
                Verified {roleLabel(profile.role).toLowerCase()}
              </span>
            </span>
          </Link>
        </div>
      </aside>

      <main
        id="main-content"
        tabIndex={-1}
        className={cx(styles.main, showTabs && styles.withTabBar)}
      >
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>

      {showTabs && (
        <nav aria-label="Main" className={cx(tabBar.tabBar, styles.tabBar)}>
          <ul role="list" className={tabBar.list}>
            {tabItems.map((item) => {
              const isActive = item.key === tabActive;
              return (
                <li key={item.key} className={tabBar.item}>
                  <Link
                    to={item.to}
                    className={cx(tabBar.tab, isActive && tabBar.active)}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon name={item.icon} size={24} />
                    <span className={tabBar.label}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
