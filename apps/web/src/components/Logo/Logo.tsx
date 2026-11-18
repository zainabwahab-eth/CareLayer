import { cx } from '../cx';
import styles from './Logo.module.css';

/*
 * Figma: Design system > Components > Logo
 * Two overlapping rounded squares (saffron over deep teal) + "CareLayer" in Literata.
 * `tone="inverse"` is the white wordmark used on primary panels (auth panel, welcome).
 */
export interface LogoProps {
  tone?: 'default' | 'inverse';
  className?: string;
}

export function Logo({ tone = 'default', className }: LogoProps) {
  return (
    <span className={cx(styles.logo, tone === 'inverse' && styles.inverse, className)}>
      <span className={styles.mark} aria-hidden>
        <span className={styles.markAccent} />
        <span className={styles.markPrimary} />
      </span>
      <span className={styles.wordmark}>CareLayer</span>
    </span>
  );
}
