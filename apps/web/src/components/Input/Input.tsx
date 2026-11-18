import { useId, type InputHTMLAttributes, type Ref } from 'react';
import { cx } from '../cx';
import styles from './Input.module.css';

/*
 * Figma: Design system > Components > Input
 * Label (Label/S) above a 1.5px-bordered field (radius 14, Body/M).
 * Always has a visible label; hint and error text are linked via aria-describedby.
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Helper text under the field. */
  hint?: string;
  /** Error message. Marks the field invalid and replaces the hint. */
  error?: string;
  id?: string;
  /** Class for the outer wrapper (label + field). */
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ label, hint, error, id, className, type = 'text', ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = `${inputId}-description`;
  const description = error ?? hint;

  return (
    <div className={cx(styles.wrapper, className)}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input
        id={inputId}
        type={type}
        className={cx(styles.field, error && styles.invalid)}
        aria-invalid={error ? true : undefined}
        aria-describedby={description ? describedById : undefined}
        {...rest}
      />
      {description && (
        <p id={describedById} className={cx(styles.description, error && styles.errorText)}>
          {description}
        </p>
      )}
    </div>
  );
}
