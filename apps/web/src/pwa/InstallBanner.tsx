import { useState } from 'react';
import { Button } from '../components/Button/Button';
import { cx } from '../components/cx';
import { Icon } from '../components/Icon/Icon';
import styles from './InstallBanner.module.css';
import { manualInstallPlatform } from './install-prompt';
import { useInstallPrompt } from './useInstallPrompt';

/*
 * "Add CareLayer to your home screen" (docs/TASKS.md H8: Android install
 * prompt, iPhone instructions, dismissible banner). No Figma frame: built from
 * the design system's surface card, Button/Primary and Button/Ghost.
 *
 * Shows whenever CareLayer is not installed and she has not said Not now in the
 * last 30 days:
 *   - Chrome/Edge offered an install: an Install button (the browser's dialog)
 *   - iPhone/iPad: Share > Add to Home Screen steps
 *   - any other browser: short steps for that device (browser menu on Android,
 *     Add to Dock in Safari on a Mac, the install option in Chrome/Edge)
 * Never shows inside the installed app.
 */
export function InstallBanner({ className }: { className?: string }) {
  const { mode, snoozed, install, dismiss } = useInstallPrompt();
  const [busy, setBusy] = useState(false);
  /** She accepted the browser's dialog: done here (the app opens on its own). */
  const [installedNow, setInstalledNow] = useState(false);

  if (snoozed || installedNow || mode === 'installed') return null;
  const manual = mode === 'none' ? manualInstallPlatform() : null;

  const onInstall = async () => {
    setBusy(true);
    try {
      if ((await install()) === 'accepted') setInstalledNow(true);
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

        {manual === 'android' && (
          <ol className={styles.steps}>
            <li>
              Open your browser’s menu (<strong>⋮</strong>).
            </li>
            <li>
              Choose <strong>Add to Home screen</strong> or <strong>Install app</strong>.
            </li>
            <li>Open CareLayer from your home screen. You may need to log in once there.</li>
          </ol>
        )}
        {manual === 'mac-safari' && (
          <ol className={styles.steps}>
            <li>
              In the menu bar, choose <strong>File</strong>, then <strong>Add to Dock</strong>.
            </li>
            <li>Open CareLayer from your Dock. You may need to log in once there.</li>
          </ol>
        )}
        {manual === 'desktop' && (
          <ol className={styles.steps}>
            <li>
              In Chrome or Edge, click the <strong>install</strong> icon at the right of the address
              bar, or open the menu (<strong>⋮</strong>) and choose{' '}
              <strong>Install CareLayer</strong>.
            </li>
            <li>
              On your phone, open <strong>carelayer.health</strong> and add it to your home screen
              from the browser’s menu.
            </li>
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
