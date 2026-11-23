import { ConnectionStatus } from './ConnectionStatus';
import styles from './PwaStatus.module.css';
import { UpdatePrompt } from './UpdatePrompt';

/*
 * App-wide notices (RootLayout): offline / back online, and "new version ready".
 * Pinned to the bottom, above the mobile tab bar, so it never covers the
 * Quick exit button in the top bar or sidebar.
 */
export function PwaStatus() {
  return (
    <div className={styles.region} role="region" aria-label="Connection and updates">
      <ConnectionStatus />
      <UpdatePrompt />
    </div>
  );
}
