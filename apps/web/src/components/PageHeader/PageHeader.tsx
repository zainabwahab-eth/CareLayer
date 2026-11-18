import type { ReactNode } from 'react';
import { cx } from '../cx';
import { QuickExitButton } from '../QuickExit/QuickExitButton';
import styles from './PageHeader.module.css';

/*
 * Figma: W05/W12 mobile "Header" and D-W05+ desktop "Header".
 * Title in Display/M with optional eyebrow above (mobile greeting, e.g.
 * "Good evening,") or subtitle below (desktop date line), optional actions
 * (e.g. notifications bell), and quick exit on the right.
 */
export interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, eyebrow, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={cx(styles.header, className)}>
      <div className={styles.titles}>
        {eyebrow && <p className={styles.muted}>{eyebrow}</p>}
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.muted}>{subtitle}</p>}
      </div>
      {actions}
      <QuickExitButton />
    </header>
  );
}
