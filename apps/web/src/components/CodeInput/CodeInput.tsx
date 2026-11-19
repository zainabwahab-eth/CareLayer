import { useId, useRef, type ClipboardEvent, type ChangeEvent, type KeyboardEvent } from 'react';
import { cx } from '../cx';
import styles from './CodeInput.module.css';

/*
 * Figma: W04 "Code". One box per digit (48 x 60, radius 14, Display/S digits);
 * the box being typed in gets a 2px primary border.
 *
 * Behaviour: typing moves to the next box, Backspace on an empty box goes back,
 * arrow keys move, and pasting or SMS/email autofill (autocomplete="one-time-code")
 * spreads a whole code across the boxes.
 */
export interface CodeInputProps {
  /** One entry per box; '' for empty. */
  digits: readonly string[];
  onChange(digits: string[]): void;
  /** Visible to screen readers only (the screen heading explains the code). */
  label?: string;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

const onlyDigits = (value: string) => value.replace(/\D/g, '');

export function CodeInput({
  digits,
  onChange,
  label = 'Verification code',
  error,
  disabled,
  autoFocus,
  className,
}: CodeInputProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const length = digits.length;

  const focusBox = (index: number) => {
    const target = refs.current[Math.max(0, Math.min(length - 1, index))];
    target?.focus();
    target?.select();
  };

  /** Write `value` starting at `index`, then move focus after the last digit written. */
  const fill = (index: number, value: string) => {
    const incoming = onlyDigits(value);
    if (!incoming) return;
    const next = [...digits];
    // A full-length code (paste / autofill) always fills from the first box.
    const start = incoming.length >= length ? 0 : index;
    const chars = incoming.slice(0, length - start).split('');
    chars.forEach((char, offset) => {
      next[start + offset] = char;
    });
    onChange(next);
    focusBox(start + chars.length);
  };

  const handleChange = (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (value === '') {
      const next = [...digits];
      next[index] = '';
      onChange(next);
      return;
    }
    const incoming = onlyDigits(value);
    // Autofill of a whole code (possibly next to an existing digit): use the last `length` digits.
    if (incoming.length >= length) {
      fill(0, incoming.slice(-length));
      return;
    }
    // The box may already hold a digit; keep only what was just typed.
    const current = digits[index];
    const typed = current && incoming.length > 1 ? incoming.replace(current, '') : incoming;
    fill(index, typed || incoming);
  };

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      onChange(next);
      focusBox(index - 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const handlePaste = (index: number) => (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    fill(index, event.clipboardData.getData('text'));
  };

  return (
    <fieldset
      className={cx(styles.fieldset, className)}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="visually-hidden">{label}</legend>
      <div className={styles.boxes}>
        {digits.map((digit, index) => (
          <input
            // Fixed number of boxes: position is the identity.
            key={index}
            ref={(element) => {
              refs.current[index] = element;
            }}
            className={cx(styles.box, error && styles.invalid)}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            aria-label={`Digit ${index + 1} of ${length}`}
            aria-invalid={error ? true : undefined}
            value={digit}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            onChange={handleChange(index)}
            onKeyDown={handleKeyDown(index)}
            onPaste={handlePaste(index)}
            onFocus={(event) => event.target.select()}
          />
        ))}
      </div>
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
