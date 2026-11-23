import { stellarExplorerUrl } from '@carelayer/shared';
import { isApiError } from '@web/api/errors';
import { isSessionError } from '@web/auth/auth-flow';
import { Alert } from '@web/components/Alert/Alert';
import { Button } from '@web/components/Button/Button';
import { cx } from '@web/components/cx';
import { Input } from '@web/components/Input/Input';
import { ThemeSwitcher } from '@web/components/ThemeSwitcher/ThemeSwitcher';
import type { ThemePreference } from '@web/theme/theme-context';
import { formatListDate, formatTime } from '@web/utils/dates';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useNurseApi } from '../api/api-context';
import { useAuth } from '../auth/useAuth';
import { useReadyProfile } from '../onboarding/profile-context';
import { paths } from '../routes/paths';
import { LoadError, Skeleton } from '../workspace/components';
import { shortAddress } from '../workspace/format';
import { useNurseQuery } from '../workspace/hooks';
import { StepUp } from '../workspace/StepUp';
import styles from '../workspace/workspace.module.css';

/*
 * Settings (no frame; docs/TASKS.md §3 "Nurse profile": payout wallet, Appearance,
 * Log out, Log out of all devices).
 *   PATCH /me/settings { appearance }  (the only setting nurses may change)
 *   PUT /nurse/payout-address          (after a fresh code)
 *   GET/DELETE /auth/sessions, POST /auth/logout, POST /auth/logout-all
 */
export function SettingsPage() {
  const { state } = useAuth();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
      </header>
      <section className={styles.card} aria-label="Account">
        <h2 className={styles.cardTitle}>Account</h2>
        <div className={styles.row}>
          <span className={styles.muted}>Email</span>
          <span className={styles.label}>{state.user?.email}</span>
        </div>
        <p className={cx(styles.caption, styles.muted)}>
          You sign in with a code sent to this email. There is no password to forget.
        </p>
      </section>
      <AppearanceSettings />
      <NotificationSettings />
      <PayoutWallet />
      <Security />
    </div>
  );
}

function AppearanceSettings() {
  const api = useNurseApi();
  const [error, setError] = useState<string>();
  const save = async (appearance: ThemePreference) => {
    setError(undefined);
    try {
      await api.me.updateSettings({ appearance });
    } catch {
      setError('Saved on this device only. We could not save it to your account.');
    }
  };
  return (
    <section className={styles.card} aria-label="Appearance">
      <ThemeSwitcher onChange={(p) => void save(p)} />
      {error && <Alert tone="info">{error}</Alert>}
    </section>
  );
}

function NotificationSettings() {
  const { profile } = useReadyProfile();
  return (
    <section className={styles.card} aria-label="Notifications">
      <h2 className={styles.cardTitle}>Notifications</h2>
      <p className={styles.bodySmall}>
        {profile.available
          ? 'We email you when a woman chooses you, and when a new question arrives in one of your topics.'
          : 'You are unavailable, so we only email you when a woman chooses you.'}{' '}
        Emails say the topic only, never the question.
      </p>
      <p className={cx(styles.caption, styles.muted)}>
        To get fewer emails, change your topics or turn off availability. Your updates are also in
        the app.
      </p>
      <div className={styles.actions}>
        <Link to={paths.profile} className={styles.link}>
          Topics and availability
        </Link>
        <Link to={paths.updates} className={styles.link}>
          Open updates
        </Link>
      </div>
    </section>
  );
}

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

function PayoutWallet() {
  const api = useNurseApi();
  const { sessionExpired } = useAuth();
  const { profile, setProfile } = useReadyProfile();
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(profile.ownStellarAddress ?? '');
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string>();
  const [needsCode, setNeedsCode] = useState(false);
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async (value: string | null) => {
    setSaving(true);
    setError(undefined);
    try {
      setProfile(await api.nurse.setPayoutAddress({ stellarAddress: value }));
      setEditing(false);
      setNeedsCode(false);
      setSaved(true);
    } catch (e) {
      if (isSessionError(e)) sessionExpired();
      if (isApiError(e) && e.code === 'STEP_UP_REQUIRED') {
        setPending(value);
        setNeedsCode(true);
      } else if (isApiError(e) && e.code === 'STELLAR_ADDRESS_INVALID') {
        setFieldError(e.message);
        setNeedsCode(false);
      } else {
        setError('We could not change your payout wallet. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = address.trim();
    if (!STELLAR_ADDRESS.test(value)) {
      setFieldError('Enter a Stellar address: 56 characters starting with G.');
      return;
    }
    if (value === profile.custodialStellarAddress) {
      setFieldError('That is your CareLayer wallet. Choose “Use my CareLayer wallet” instead.');
      return;
    }
    setFieldError(undefined);
    setSaved(false);
    void save(value);
  };

  return (
    <section className={styles.card} aria-label="Payout wallet">
      <h2 className={styles.cardTitle}>Payout wallet</h2>
      <p className={styles.bodySmall}>
        {profile.ownStellarAddress ? (
          <>
            Payouts go to your own wallet{' '}
            <span className={styles.address}>{shortAddress(profile.ownStellarAddress)}</span>.
          </>
        ) : (
          <>
            Payouts go to your CareLayer wallet{' '}
            <a
              className={cx(styles.address, styles.link)}
              href={stellarExplorerUrl('account', profile.custodialStellarAddress)}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddress(profile.custodialStellarAddress)}
            </a>
            . You can withdraw from it at any time.
          </>
        )}
      </p>
      {saved && (
        <p className={cx(styles.caption, styles.muted)} role="status">
          Payout wallet saved.
        </p>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      {needsCode && pending !== undefined ? (
        <StepUp
          reason="Before you change where you are paid"
          onConfirmed={() => void save(pending)}
        />
      ) : editing ? (
        <form
          className={styles.stack}
          style={{ gap: 'var(--space-12)' }}
          onSubmit={submit}
          noValidate
        >
          <Input
            label="Your Stellar wallet address"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={address}
            onChange={(e) => setAddress(e.target.value.trim())}
            error={fieldError}
            hint="Payouts will go here instead of your CareLayer wallet. It must accept USDC."
          />
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save wallet'}
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {profile.ownStellarAddress ? 'Change wallet' : 'Use my own wallet'}
          </Button>
          {profile.ownStellarAddress && (
            <Button variant="ghost" onClick={() => void save(null)} disabled={saving}>
              Use my CareLayer wallet
            </Button>
          )}
        </div>
      )}
      <p className={cx(styles.caption, styles.muted)}>
        For your safety, we email you a code before changing this.
      </p>
    </section>
  );
}

function Security() {
  const api = useNurseApi();
  const { logout, logoutAll } = useAuth();
  const sessions = useNurseQuery((a) => a.auth.listSessions());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const revoke = async (id: string) => {
    setBusy(id);
    setError(undefined);
    try {
      await api.auth.revokeSession(id);
      sessions.reload();
    } catch {
      setError('We could not sign out that device. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const everywhere = async () => {
    setBusy('all');
    setError(undefined);
    try {
      await logoutAll();
    } catch {
      setBusy(null);
      setError('We could not log out of all devices. Please try again.');
    }
  };

  return (
    <section className={styles.card} aria-label="Privacy and security">
      <h2 className={styles.cardTitle}>Privacy and security</h2>
      <h3 className={styles.label} style={{ margin: 0 }}>
        Where you’re signed in
      </h3>
      {sessions.status === 'loading' && <Skeleton count={1} height="3rem" />}
      {sessions.status === 'error' && (
        <LoadError
          error={sessions.error}
          fallback="We could not load your devices."
          onRetry={sessions.reload}
        />
      )}
      {sessions.data && (
        <ul role="list" className={styles.list}>
          {sessions.data.map((s) => (
            <li key={s.id} className={styles.listItem}>
              <span className={styles.stack}>
                <span className={styles.label}>
                  {s.deviceName ?? 'Unknown device'}
                  {s.current && ' (this device)'}
                </span>
                <span className={cx(styles.caption, styles.muted)}>
                  Last used {formatListDate(s.lastUsedAt)}, {formatTime(s.lastUsedAt)}
                </span>
              </span>
              {!s.current && (
                <Button variant="ghost" onClick={() => void revoke(s.id)} disabled={busy !== null}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => void logout()} disabled={busy !== null}>
          Log out
        </Button>
        <Button variant="secondary" onClick={() => void everywhere()} disabled={busy !== null}>
          {busy === 'all' ? 'Logging out…' : 'Log out of all devices'}
        </Button>
      </div>
      <p className={cx(styles.caption, styles.muted)}>
        Women never see your email, phone or licence number. You never see theirs.
      </p>
    </section>
  );
}
