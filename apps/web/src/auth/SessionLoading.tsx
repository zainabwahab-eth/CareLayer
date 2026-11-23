import { Logo } from '../components/Logo/Logo';
import { QuickExitButton } from '../components/QuickExit/QuickExitButton';
import styles from './SessionLoading.module.css';

/**
 * Shown while the saved session is restored. Usually a moment, but on a weak
 * connection it can last, so Quick exit is here too (top right, as in the app's top bar).
 */
export function SessionLoading() {
  return (
    <main id="main-content" tabIndex={-1} className={styles.screen}>
      <div className={styles.topBar}>
        <QuickExitButton />
      </div>
      <Logo />
      <p role="status" className={styles.label}>
        Loading…
      </p>
    </main>
  );
}
