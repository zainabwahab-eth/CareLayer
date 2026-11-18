import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../Icon/Icon';
import styles from './Badge.module.css';

/*
 * Figma: Design system > Components > Badges
 *   Badge/Verified  - a verified professional only ("Licence verified"). Includes shield icon.
 *   Badge/Emergency - emergencies only. Includes alert icon.
 *   Badge/Neutral   - categories ("Pregnancy")
 *   Badge/Accent    - in progress ("Reviewing")
 *   Badge/Primary   - done / positive ("Answered")
 */
export type BadgeVariant = 'verified' | 'emergency' | 'neutral' | 'accent' | 'primary';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: ReactNode;
}

const variantIcon: Partial<Record<BadgeVariant, 'shield' | 'alert'>> = {
  verified: 'shield',
  emergency: 'alert',
};

export function Badge({ variant = 'neutral', className, children, ...rest }: BadgeProps) {
  const icon = variantIcon[variant];
  return (
    <span className={cx(styles.badge, styles[variant], className)} {...rest}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}
