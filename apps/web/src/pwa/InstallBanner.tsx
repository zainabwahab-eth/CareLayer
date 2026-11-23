import { useState } from 'react';
import { Button } from '../components/Button/Button';
import { cx } from '../components/cx';
import { Icon } from '../components/Icon/Icon';
import styles from './InstallBanner.module.css';
import { useInstallPrompt } from './useInstallPrompt';

/*
 * "Add CareLayer to your home screen" (docs/TASKS.md H8: Android install
 * prompt, iPhone instructions, dismissible banner). No Figma frame: built from
 * the design system's surface card, Button/Primary and Button/Ghost.
 *
 * Shows only when there is something to do (Chrome offered an install, or an
 * iPhone/iPad browser) and she has not said Not now in the last 30 days. Never
 * shows inside the installed app.
 */
export function InstallBanner({ className }: { className?: string }) {
  const { mode, snoozed, install, dismiss } = useInstallPrompt();
  const [busy, setBusy] = useState(false);

  if (snoozed || (mode !== 'prompt' && mode !== 'ios')) return null;

  const onInstall = async () => {
    setBusy(true);
    try {
      await install();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cx(styles.banner, className)} aria-labelledby="install-banner-title">
      <span className={styles.badge} aria-hidden>
        <Icon name="home" size={22} />
      </span>
      <div className={styles.body}>
        <h2 id="install-banner-title" className={styles.title}>
          Add CareLayer to your home screen
        </h2>
        <p className={styles.text}>
          Open it in one tap, like an app. Only add it if it is safe for others to see CareLayer on
          your phone.
        </p>

        {mode === 'ios' && (
          <ol className={styles.steps}>
            <li>
              Tap the <strong>Share</strong> button (the square with an arrow).
            </li>
            <li>
              Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </li>
            <li>Open CareLayer from your home screen. You may need to log in once there.</li>
          </ol>
        )}

        <div className={styles.actions}>
          {mode === 'prompt' && (
            <Button onClick={onInstall} disabled={busy}>
              Install CareLayer
            </Button>
          )}
          <Button variant="ghost" onClick={dismiss}>
            Not now
          </Button>
        </div>
      </div>
    </section>
  );
}
