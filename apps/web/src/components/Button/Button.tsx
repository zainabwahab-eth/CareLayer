import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from '../cx';
import styles from './Button.module.css';

/*
 * Figma: Design system > Components > Buttons
 *   Button/Primary   - main action ("Continue")
 *   Button/Secondary - alternative action ("Continue with Google")
 *   Button/Ghost     - low-emphasis action ("Not now")
 *   Button/Emergency - emergency flow only ("Call 112"). Red is never decorative.
 * Labels should say what happens: "Confirm and send", not "Submit".
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'emergency';

interface ButtonStyleProps {
  variant?: ButtonVariant;
  /** Stretch to the container width (mobile CTAs, sidebar "Ask a question"). */
  fullWidth?: boolean;
  /** Optional icon before the label (e.g. <Icon name="lock" />). */
  leadingIcon?: ReactNode;
  children: ReactNode;
}

export interface ButtonProps
  extends ButtonStyleProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  ref?: Ref<HTMLButtonElement>;
}

export interface ButtonLinkProps extends ButtonStyleProps, Omit<LinkProps, 'children'> {
  ref?: Ref<HTMLAnchorElement>;
}

function classNames(variant: ButtonVariant, fullWidth: boolean, className?: string) {
  return cx(styles.button, styles[variant], fullWidth && styles.fullWidth, className);
}

export function Button({
  variant = 'primary',
  fullWidth = false,
  leadingIcon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={classNames(variant, fullWidth, className)} {...rest}>
      {leadingIcon}
      <span>{children}</span>
    </button>
  );
}

/** A router link that looks like a Button. Use for navigation, not actions. */
export function ButtonLink({
  variant = 'primary',
  fullWidth = false,
  leadingIcon,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={classNames(variant, fullWidth, className)} {...rest}>
      {leadingIcon}
      <span>{children}</span>
    </Link>
  );
}
