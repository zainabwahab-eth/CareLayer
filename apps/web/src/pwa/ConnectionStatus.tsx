import { useEffect, useState } from 'react';
import { Alert } from '../components/Alert/Alert';
import { Button } from '../components/Button/Button';
import styles from './PwaStatus.module.css';
import { useOnlineStatus } from './useOnlineStatus';

/** How long "You're back online" stays before it fades away. */
export const RESTORED_NOTICE_MS = 4_000;

type Phase = 'idle' | 'offline' | 'restored';

/*
 * Offline and connection-restored notices. Screens still show their own
 * "Could not reach CareLayer" errors for the request that failed; this tells
 * her why, and that Quick exit and the emergency screen still work.
 */
export function ConnectionStatus() {
  const online = useOnlineStatus();
  const [phase, setPhase] = useState<Phase>(online ? 'idle' : 'offline');
  const [hidden, setHidden] = useState(false);
  const [lastOnline, setLastOnline] = useState(online);

  // Adjust state while rendering when the connection changes (no effect needed).
  if (online !== lastOnline) {
    setLastOnline(online);
    setPhase(online ? 'restored' : 'offline');
    setHidden(false);
  }

  useEffect(() => {
    if (phase !== 'restored') return;
    const timer = window.setTimeout(() => setPhase('idle'), RESTORED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === 'offline' && !hidden) {
    return (
      <Alert tone="info" className={styles.notice}>
        <p className={styles.noticeTitle}>You’re offline</p>
        <p className={styles.noticeText}>
          What’s on screen stays here. Sending, paying and new answers will wait until you’re back
          online. In an emergency, call your local emergency number or go to the nearest hospital.
        </p>
        <div className={styles.noticeActions}>
          <Button variant="ghost" onClick={() => setHidden(true)}>
            Hide
          </Button>
        </div>
      </Alert>
    );
  }

  if (phase === 'restored') {
    return (
      <Alert tone="success" className={styles.notice}>
        <p className={styles.noticeTitle}>You’re back online</p>
      </Alert>
    );
  }

  return null;
}
