import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../cx';
import styles from './Chip.module.css';

/*
 * Figma: Design system > Components > Chips
 *   Chip/Default  - unselected filter / suggestion ("Pregnancy")
 *   Chip/Selected - active filter ("All")
 * Rendered as a toggle button: `selected` maps to aria-pressed.
 */
export interface ChipProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-pressed'
> {
  selected?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Chip({
  selected = false,
  className,
  type = 'button',
  children,
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(styles.chip, selected && styles.selected, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
