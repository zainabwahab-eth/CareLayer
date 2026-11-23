import styles from '@web/auth/SessionLoading.module.css';
import { Alert } from '@web/components/Alert/Alert';
import { Button } from '@web/components/Button/Button';
import { Logo } from '@web/components/Logo/Logo';

/*
 * Whole-screen loading and failure states (restoring the session, loading her
 * profile). apps/web's SessionLoading styles, without the women's Quick exit.
 */
export function FullScreenLoading() {
  return (
    <main id="main-content" tabIndex={-1} className={styles.screen}>
      <Logo />
      <p role="status" className={styles.label}>
        Loading…
      </p>
    </main>
  );
}

export function FullScreenError({
  message,
  onRetry,
  onLogout,
}: {
  message: string;
  onRetry: () => void;
  onLogout?: () => void;
}) {
  return (
    <main id="main-content" tabIndex={-1} className={styles.screen}>
      <Logo />
      <Alert tone="error">{message}</Alert>
      <Button onClick={onRetry}>Try again</Button>
      {onLogout && (
        <Button variant="ghost" onClick={onLogout}>
          Log out
        </Button>
      )}
    </main>
  );
}
