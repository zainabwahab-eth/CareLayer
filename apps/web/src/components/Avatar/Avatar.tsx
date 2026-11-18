import type { CSSProperties } from 'react';
import { cx } from '../cx';
import styles from './Avatar.module.css';

/*
 * Figma: Design system > Components > Avatar
 * Clay-rose circle with initials (rose = "people, avatars"). 44px by default;
 * the desktop sidebar profile uses 36px.
 */
export interface AvatarProps {
  /** Full name. Used to derive initials and as the accessible name. */
  name: string;
  /** Override the derived initials. */
  initials?: string;
  size?: number;
  /** Set when a visible name already sits next to the avatar. */
  decorative?: boolean;
  className?: string;
}

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, initials, size = 44, decorative = false, className }: AvatarProps) {
  return (
    <span
      className={cx(styles.avatar, className)}
      style={{ '--avatar-size': `${size}px` } as CSSProperties}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
    >
      {initials ?? initialsFrom(name)}
    </span>
  );
}
