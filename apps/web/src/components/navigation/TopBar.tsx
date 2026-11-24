import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '../cx';
import { Icon } from '../Icon/Icon';
import { QuickExitButton } from '../QuickExit/QuickExitButton';
import styles from './TopBar.module.css';

/*
 * Figma: Women - mobile > W06-W11 "Top bar"
 * Back arrow, title (Title/M) with optional step/subtitle (Caption), quick exit.
 */
export interface TopBarProps {
  title: string;
  /** e.g. "Step 1 of 3". */
  subtitle?: string;
  /** Where Back goes. Omit to hide the back button. */
  backTo?: string;
  backLabel?: string;
  /** Extra controls before Quick exit (e.g. W06 "New chat"). */
  actions?: ReactNode;
  className?: string;
}

export function TopBar({
  title,
  subtitle,
  backTo,
  backLabel = 'Back',
  actions,
  className,
}: TopBarProps) {
  return (
    <header className={cx(styles.topBar, className)}>
      {backTo && (
        <Link to={backTo} className={styles.back} aria-label={backLabel}>
          <Icon name="back" size={24} />
        </Link>
      )}
      <div className={styles.titles}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions}
      <QuickExitButton />
    </header>
  );
}
