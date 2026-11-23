import { useRegisterSW } from 'virtual:pwa-register/react';
import { Alert } from '../components/Alert/Alert';
import { Button } from '../components/Button/Button';
import styles from './PwaStatus.module.css';

/** Look for a new version this often while the app stays open. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/*
 * Safe updates. A new version never reloads the page by itself (that would
 * wipe a chat she is in the middle of): it waits until she taps "Update now",
 * or until every CareLayer tab is closed, whichever comes first. Her session
 * survives either way (the refresh cookie is not touched).
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      window.setInterval(() => {
        if (window.navigator.onLine) void registration.update();
      }, UPDATE_CHECK_MS);
    },
  });

  // First visit: no version is running under a service worker yet, so the new
  // one takes over on the next load and there is nothing to ask.
  if (!needRefresh || !window.navigator.serviceWorker?.controller) return null;

  return (
    <Alert tone="info" className={styles.notice}>
      <p className={styles.noticeTitle}>A new version of CareLayer is ready</p>
      <p className={styles.noticeText}>
        Updating reloads the page, so finish what you’re writing first. You stay logged in.
      </p>
      <div className={styles.noticeActions}>
        <Button onClick={() => void updateServiceWorker(true)}>Update now</Button>
        <Button variant="ghost" onClick={() => setNeedRefresh(false)}>
          Later
        </Button>
      </div>
    </Alert>
  );
}
