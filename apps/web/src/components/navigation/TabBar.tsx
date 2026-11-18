import { Link } from 'react-router';
import { cx } from '../cx';
import { Icon } from '../Icon/Icon';
import { navItems, type NavKey } from './nav-items';
import styles from './TabBar.module.css';

/*
 * Figma: Design system > Tab bar/Women/{Home,Ask,History,Account}
 * Mobile bottom navigation. `active` comes from the current route's handle,
 * so nested screens (e.g. a consultation) still highlight the right tab.
 */
export interface TabBarProps {
  active?: NavKey;
  className?: string;
}

export function TabBar({ active, className }: TabBarProps) {
  return (
    <nav aria-label="Main" className={cx(styles.tabBar, className)}>
      <ul role="list" className={styles.list}>
        {navItems.map((item) => {
          const isActive = item.key === active;
          return (
            <li key={item.key} className={styles.item}>
              <Link
                to={item.to}
                className={cx(styles.tab, isActive && styles.active)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon name={item.icon} size={24} />
                <span className={styles.label}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
