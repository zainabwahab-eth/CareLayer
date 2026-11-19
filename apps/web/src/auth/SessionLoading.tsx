import { Logo } from '../components/Logo/Logo';
import styles from './SessionLoading.module.css';

/** Shown for a moment while the saved session is restored. */
export function SessionLoading() {
  return (
    <main id="main-content" tabIndex={-1} className={styles.screen}>
      <Logo />
      <p role="status" className={styles.label}>
        Loading…
      </p>
    </main>
  );
}
