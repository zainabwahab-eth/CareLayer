import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../Icon/Icon';
import styles from './Alert.module.css';

/*
 * Inline message for a whole form or screen (not one field: use Input's `error`).
 *   error   - something failed; announced immediately (role="alert")
 *   info    - neutral note, e.g. "Your session ended"
 *   success - confirmation, e.g. "We sent a new code"
 * Built from the design system's soft background tokens; not a Figma component yet.
 */
export interface AlertProps {
  tone?: 'error' | 'info' | 'success';
  children: ReactNode;
  className?: string;
}

export function Alert({ tone = 'info', children, className }: AlertProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(styles.alert, styles[tone], className)}
    >
      {tone === 'error' && <Icon name="alert" size={18} className={styles.icon} />}
      <div className={styles.body}>{children}</div>
    </div>
  );
}
