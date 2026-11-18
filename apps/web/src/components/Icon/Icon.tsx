import type { CSSProperties } from 'react';
import { cx } from '../cx';
import { resolveIcon, type IconName } from './icons';
import styles from './Icon.module.css';

export interface IconProps {
  name: IconName;
  /** Rendered size in px. Defaults to the icon's Figma frame size. */
  size?: number;
  /**
   * Accessible name. Omit for decorative icons (the default), which are
   * hidden from assistive tech because a visible label sits next to them.
   */
  label?: string;
  className?: string;
}

function percent(offset: number, frame: number, length: number) {
  const free = frame - length;
  return free <= 0 ? '50%' : `${(offset / free) * 100}%`;
}

/** Monochrome icon that inherits `color` from its parent. */
export function Icon({ name, size, label, className }: IconProps) {
  const icon = resolveIcon(name, size);
  const style = {
    '--icon-size': `${size ?? icon.frame}px`,
    '--icon-src': `url("${icon.src}")`,
    '--icon-mask-size': `${(icon.w / icon.frame) * 100}% ${(icon.h / icon.frame) * 100}%`,
    '--icon-mask-position': `${percent(icon.x, icon.frame, icon.w)} ${percent(icon.y, icon.frame, icon.h)}`,
  } as CSSProperties;

  return (
    <span
      className={cx(styles.icon, className)}
      style={style}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
