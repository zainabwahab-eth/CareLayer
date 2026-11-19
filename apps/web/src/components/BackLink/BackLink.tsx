import { Link, type LinkProps } from 'react-router';
import { cx } from '../cx';
import { Icon } from '../Icon/Icon';
import styles from './BackLink.module.css';

/*
 * Figma: W02 / W04 "icon/back" at the top of the body (no top bar).
 * The 24px glyph sits on the content edge; the tap target is 48px.
 */
export interface BackLinkProps extends Omit<LinkProps, 'children' | 'aria-label'> {
  /** Accessible name, e.g. "Back to sign up". */
  label?: string;
}

export function BackLink({ label = 'Back', className, ...rest }: BackLinkProps) {
  return (
    <Link className={cx(styles.back, className)} aria-label={label} {...rest}>
      <Icon name="back" size={24} />
    </Link>
  );
}
