import { cx } from '../cx';
import { Icon } from '../Icon/Icon';
import { quickExit } from './quick-exit';
import styles from './QuickExitButton.module.css';

/*
 * Figma: "Quick exit" on every women's screen.
 *   variant="pill"  - saffron-soft pill in mobile top bars and desktop page headers
 *   variant="block" - full-width block at the bottom of the desktop sidebar, with the "Esc Esc" hint
 */
export interface QuickExitButtonProps {
  variant?: 'pill' | 'block';
  className?: string;
}

export function QuickExitButton({ variant = 'pill', className }: QuickExitButtonProps) {
  const isBlock = variant === 'block';
  return (
    <button
      type="button"
      className={cx(styles.quickExit, isBlock ? styles.block : styles.pill, className)}
      onClick={quickExit}
      aria-label="Quick exit: leave CareLayer now"
      aria-keyshortcuts={isBlock ? 'Escape Escape' : undefined}
    >
      <Icon name="eyeOff" size={isBlock ? 18 : 16} />
      <span className={styles.label}>Quick exit</span>
      {isBlock && (
        <kbd className={styles.shortcut} aria-hidden>
          Esc Esc
        </kbd>
      )}
    </button>
  );
}
