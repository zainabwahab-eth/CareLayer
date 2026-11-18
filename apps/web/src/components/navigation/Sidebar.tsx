import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { paths } from '../../routes/paths';
import { Avatar } from '../Avatar/Avatar';
import { ButtonLink } from '../Button/Button';
import { cx } from '../cx';
import { Icon } from '../Icon/Icon';
import { Logo } from '../Logo/Logo';
import { QuickExitButton } from '../QuickExit/QuickExitButton';
import { navItems, type NavKey } from './nav-items';
import styles from './Sidebar.module.css';

/*
 * Figma: Women - Desktop > Sidebar/Women/{Home,Ask,History}
 * Logo, "Ask a question", primary nav, then (bottom) balance card,
 * quick exit and the signed-in profile.
 */
export interface SidebarUser {
  name: string;
  email: string;
}

export interface SidebarProps {
  active?: NavKey;
  user?: SidebarUser;
  /** Wallet summary card. Pass any node (e.g. <BalanceCard />); omitted when not loaded. */
  balance?: ReactNode;
  className?: string;
}

export function Sidebar({ active, user, balance, className }: SidebarProps) {
  return (
    <aside className={cx(styles.sidebar, className)} aria-label="Sidebar">
      <Link to={paths.home} className={styles.brand} aria-label="CareLayer home">
        <Logo />
      </Link>

      <ButtonLink to={paths.ask} fullWidth>
        Ask a question
      </ButtonLink>

      <nav aria-label="Main" className={styles.nav}>
        <ul role="list" className={styles.navList}>
          {navItems.map((item) => {
            const isActive = item.key === active;
            return (
              <li key={item.key}>
                <Link
                  to={item.to}
                  className={cx(styles.navItem, isActive && styles.navItemActive)}
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

      <div className={styles.footer}>
        {balance}
        <QuickExitButton variant="block" />
        {user && (
          <div className={styles.profile}>
            <Avatar name={user.name} size={36} decorative />
            <div className={styles.who}>
              <span className={styles.name}>{user.name}</span>
              <span className={styles.email}>{user.email}</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export interface BalanceCardProps {
  /** Pre-formatted amount, e.g. "₦3,500". */
  amount: string;
  /** e.g. "2 of 3 free answers left". */
  note?: string;
  topUpTo?: string;
}

/** Figma: Sidebar > Balance. */
export function BalanceCard({ amount, note, topUpTo }: BalanceCardProps) {
  return (
    <section className={styles.balance} aria-label="Balance">
      <span className={styles.balanceLabel} aria-hidden>
        Balance
      </span>
      <div className={styles.balanceRow}>
        <span className={styles.balanceAmount}>{amount}</span>
        {topUpTo && (
          <Link to={topUpTo} className={styles.topUp}>
            Top up
          </Link>
        )}
      </div>
      {note && <span className={styles.balanceNote}>{note}</span>}
    </section>
  );
}
