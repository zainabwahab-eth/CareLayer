import { useTheme } from '../../theme/useTheme';
import type { ThemePreference } from '../../theme/theme-context';
import { Chip } from '../Chip/Chip';
import { cx } from '../cx';
import styles from './ThemeSwitcher.module.css';

const options: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Appearance: System / Light / Dark, built from Chip so it matches the design system.
 * Applies instantly on this device; `onChange` lets a screen also save it elsewhere
 * (Account saves it with her settings).
 */
export function ThemeSwitcher({
  className,
  onChange,
}: {
  className?: string;
  onChange?: (preference: ThemePreference) => void;
}) {
  const { preference, setPreference } = useTheme();
  return (
    <fieldset className={cx(styles.fieldset, className)}>
      <legend className={styles.legend}>Appearance</legend>
      <div className={styles.options}>
        {options.map((option) => (
          <Chip
            key={option.value}
            selected={preference === option.value}
            onClick={() => {
              setPreference(option.value);
              onChange?.(option.value);
            }}
          >
            {option.label}
          </Chip>
        ))}
      </div>
    </fieldset>
  );
}
