import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx } from '../cx';
import { Icon } from '../Icon/Icon';
import styles from './Checkbox.module.css';

/*
 * Figma: W02 "Agreement" checkbox. 24px box, radius 7; checked = primary fill
 * with a white check (icon/check 16). A native checkbox underneath keeps it
 * keyboard- and screen-reader-accessible. The whole row is the click target.
 */
export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'id' | 'children'
> {
  children: ReactNode;
  /** Error message under the row. Marks the checkbox invalid. */
  error?: string;
  id?: string;
  /** Class for the clickable row (e.g. to give it a card background). */
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Checkbox({ children, error, id, className, ...rest }: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div className={styles.wrapper}>
      <label htmlFor={inputId} className={cx(styles.row, error && styles.invalid, className)}>
        <input
          id={inputId}
          type="checkbox"
          className={styles.input}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        />
        <span className={styles.box} aria-hidden>
          <Icon name="check" size={16} className={styles.check} />
        </span>
        <span className={styles.label}>{children}</span>
      </label>
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
