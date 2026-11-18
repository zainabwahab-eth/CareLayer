import type { ButtonHTMLAttributes, Ref } from 'react';
import { cx } from '../cx';
import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/icons';
import styles from './IconButton.module.css';

/** Icon-only button with a 48px touch target (e.g. the desktop header bell). */
export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  icon: IconName;
  /** Required accessible name, since there is no visible text. */
  label: string;
  iconSize?: number;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon,
  label,
  iconSize = 24,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button type={type} aria-label={label} className={cx(styles.iconButton, className)} {...rest}>
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
