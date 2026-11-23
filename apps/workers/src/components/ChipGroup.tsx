import type { ReactNode, Ref } from 'react';
import { useId } from 'react';
import styles from './ChipGroup.module.css';

/*
 * A labelled group of design-system Chips (Figma N02 "I am a", "Topics you'll
 * answer"), as a fieldset with a legend so screen readers announce the question,
 * plus an error line like Input's.
 */
export function ChipGroup({
  legend,
  hint,
  error,
  children,
  ref,
}: {
  legend: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  ref?: Ref<HTMLFieldSetElement>;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <fieldset
      ref={ref}
      className={styles.fieldset}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
    >
      <legend className={styles.legend}>{legend}</legend>
      {hint && !error && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      <div className={styles.options}>{children}</div>
      {error && (
        <p id={`${id}-error`} className={styles.error}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
