import { useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { Avatar } from '../../components/Avatar/Avatar';
import { Button } from '../../components/Button/Button';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { ThemeSwitcher } from '../../components/ThemeSwitcher/ThemeSwitcher';
import styles from './AccountPage.module.css';

/**
 * Account tab. Figma has no Account screen yet, so this holds who is signed
 * in, the Appearance setting (System / Light / Dark) and Log out; profile
 * editing and wallet come in later phases.
 */
export function AccountPage() {
  const { state, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const user = state.user;

  const handleLogout = async () => {
    setLoggingOut(true);
    // Never rejects; RequireAuth then takes her to the Welcome page.
    await logout();
  };

  return (
    <div className={styles.page}>
      <PageHeader title="Account" />
      {user && (
        <section className={styles.card} aria-label="Signed in as">
          <div className={styles.profile}>
            <Avatar name={user.displayName} size={44} decorative />
            <div className={styles.identity}>
              <p className={styles.name}>{user.displayName}</p>
              <p className={styles.email}>{user.email}</p>
            </div>
          </div>
        </section>
      )}
      <section className={styles.card} aria-label="Settings">
        <ThemeSwitcher />
      </section>
      <Button
        variant="secondary"
        onClick={handleLogout}
        disabled={loggingOut}
        aria-busy={loggingOut || undefined}
        className={styles.logout}
      >
        {loggingOut ? 'Logging out…' : 'Log out'}
      </Button>
    </div>
  );
}
