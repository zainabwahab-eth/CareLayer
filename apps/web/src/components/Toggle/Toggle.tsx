import { useId, type ButtonHTMLAttributes, type Ref } from 'react';
import { cx } from '../cx';
import styles from './Toggle.module.css';

/*
 * Figma: Design system > Components > Toggle/On, Toggle/Off
 * 48x28 track, 22px knob. Implemented as a native button with role="switch".
 * Pass `label` for a visible label, or `aria-label` when the label lives elsewhere.
 */
export interface ToggleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'role' | 'aria-checked'
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label shown before the switch. */
  label?: string;
  /** Optional supporting text under the label. */
  description?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  description,
  className,
  disabled,
  onClick,
  ...rest
}: ToggleProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;

  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      disabled={disabled}
      className={cx(styles.track, checked && styles.on, !label && className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      {...rest}
    >
      <span className={styles.knob} aria-hidden />
    </button>
  );

  if (!label) return control;

  return (
    <div className={cx(styles.row, className)}>
      <div className={styles.text}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        {description && (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        )}
      </div>
      {control}
    </div>
  );
}
