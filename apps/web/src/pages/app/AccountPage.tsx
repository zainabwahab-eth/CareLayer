import type { NotificationPreferences, QuickExitTarget, UserSettings } from '@carelayer/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { loadErrorMessage } from '../../api/error-message';
import { useAuth } from '../../auth/useAuth';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { Alert } from '../../components/Alert/Alert';
import { Button } from '../../components/Button/Button';
import { Chip } from '../../components/Chip/Chip';
import { Icon } from '../../components/Icon/Icon';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import {
  quickExit,
  readQuickExitTarget,
  storeQuickExitTarget,
} from '../../components/QuickExit/quick-exit';
import { ThemeSwitcher } from '../../components/ThemeSwitcher/ThemeSwitcher';
import { Toggle } from '../../components/Toggle/Toggle';
import { paths } from '../../routes/paths';
import { formatNaira } from '../../utils/money';
import { ProfileCard } from './account/ProfileCard';
import { useSavedResource, type SaveState } from './account/useSavedResource';
import styles from './AccountPage.module.css';

const QUICK_EXIT_OPTIONS: ReadonlyArray<{ value: QuickExitTarget; label: string }> = [
  { value: 'google', label: 'Google' },
  { value: 'weather', label: 'Weather' },
  { value: 'news', label: 'News' },
];

/** 0 = ask before every paid answer. Other values are naira amounts in kobo. */
const LIMIT_PRESETS_KOBO = [0, 50_000, 100_000, 200_000, 500_000] as const;

const limitLabel = (kobo: number) => (kobo === 0 ? 'Always ask me' : formatNaira(kobo));

/**
 * Account (no Figma frame; docs/TASKS.md §3 "Women account"): name and email,
 * wallet, Appearance, Quick exit opens, spending limit per answer, notify me
 * when answered, Use CareLayer in Claude, Add to Home Screen, Log out, Log out
 * of all devices. Data: GET/PATCH /me, /me/settings, /me/notifications,
 * POST /auth/logout, /auth/logout-all (contract §2-3).
 */
export function AccountPage() {
  const { state } = useAuth();
  const user = state.user;

  const settings = useSavedResource<UserSettings>(
    (api) => api.me.getSettings(),
    (api, patch) => api.me.updateSettings(patch),
  );
  const notifications = useSavedResource<NotificationPreferences>(
    (api) => api.me.getNotifications(),
    (api, patch) => api.me.updateNotifications(patch),
  );
  useSessionGuard(
    settings.error,
    notifications.error,
    settings.saveState.status === 'error' ? settings.saveState.error : undefined,
    notifications.saveState.status === 'error' ? notifications.saveState.error : undefined,
  );

  // Quick exit works from this device's copy (it must work offline and before
  // sign-in). Her account's choice wins when it loads, so devices agree.
  const [deviceTarget] = useState(readQuickExitTarget);
  const [chosenTarget, setChosenTarget] = useState<QuickExitTarget | null>(null);
  const [quickExitLocalOnly, setQuickExitLocalOnly] = useState(false);
  const loadedTarget = settings.loaded?.quickExitTarget;
  const quickExitTarget = chosenTarget ?? loadedTarget ?? deviceTarget;
  // Her account's choice replaces this device's copy, unless she just picked one here.
  const pickedHere = chosenTarget !== null;
  useEffect(() => {
    if (loadedTarget && !pickedHere) storeQuickExitTarget(loadedTarget);
  }, [loadedTarget, pickedHere]);

  const chooseQuickExit = async (target: QuickExitTarget) => {
    // Locally first, so the button uses it even if the save fails.
    storeQuickExitTarget(target);
    setChosenTarget(target);
    setQuickExitLocalOnly(false);
    if (settings.current) {
      const ok = await settings.update('quickExitTarget', { quickExitTarget: target });
      setQuickExitLocalOnly(!ok);
    } else {
      setQuickExitLocalOnly(true);
    }
  };

  const settingsUnavailable = settings.status === 'error' && (
    <div className={styles.inlineError}>
      <Alert tone="error">
        {loadErrorMessage(settings.error, 'We could not load these settings.')}
      </Alert>
      <Button variant="secondary" onClick={settings.reload}>
        Try again
      </Button>
    </div>
  );
  const settingsLoading = settings.status === 'loading' && (
    <p className={styles.muted} role="status">
      Loading…
    </p>
  );

  return (
    <div className={styles.page}>
      <PageHeader title="Account" />

      {user && <ProfileCard user={user} />}

      <Link to={paths.wallet} className={styles.linkCard}>
        <span className={styles.linkCardText}>
          <span className={styles.linkCardTitle}>Wallet</span>
          <span className={styles.muted}>Balance, top-ups and what you paid</span>
        </span>
        <Icon name="chevron" size={18} />
      </Link>

      <Section title="Appearance" hideTitle>
        <ThemeSwitcher
          onChange={(appearance) => {
            // Applied on this device already; saving it to her account is best effort.
            if (settings.current) void settings.update('appearance', { appearance });
          }}
        />
        <SaveStatus state={settings.saveState} field="appearance" />
      </Section>

      <Section
        title="Quick exit opens"
        description="Where Quick exit takes you. It replaces this page, so Back does not return to CareLayer."
      >
        <div className={styles.chips} role="group" aria-label="Quick exit opens">
          {QUICK_EXIT_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              selected={quickExitTarget === option.value}
              onClick={() => void chooseQuickExit(option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        {quickExitLocalOnly ? (
          <p className={styles.muted} role="status">
            Saved on this device only. We could not save it to your account.
          </p>
        ) : (
          <SaveStatus state={settings.saveState} field="quickExitTarget" />
        )}
        <Button variant="secondary" onClick={quickExit} className={styles.inlineButton}>
          Try it now
        </Button>
        <p className={styles.muted}>Try it now leaves CareLayer straight away.</p>
      </Section>

      <Section
        title="Spending limit per answer"
        description="Answers above this amount ask you first. You only pay when you open an answer."
      >
        {settingsLoading}
        {settingsUnavailable}
        {settings.current && (
          <LimitChips
            label="Spending limit per answer"
            value={settings.current.spendingLimitPerAnswerKobo}
            onChange={(kobo) =>
              void settings.update('spendingLimitPerAnswerKobo', {
                spendingLimitPerAnswerKobo: kobo,
              })
            }
          />
        )}
        <SaveStatus state={settings.saveState} field="spendingLimitPerAnswerKobo" />
      </Section>

      <Section title="Notifications" hideTitle>
        {notifications.status === 'loading' && (
          <p className={styles.muted} role="status">
            Loading…
          </p>
        )}
        {notifications.status === 'error' && (
          <div className={styles.inlineError}>
            <Alert tone="error">
              {loadErrorMessage(notifications.error, 'We could not load your notifications.')}
            </Alert>
            <Button variant="secondary" onClick={notifications.reload}>
              Try again
            </Button>
          </div>
        )}
        {notifications.current && (
          <Toggle
            label="Notify me when answered"
            description={user ? `By email to ${user.email}. Nothing else is sent.` : 'By email.'}
            checked={notifications.current.notifyWhenAnswered}
            onCheckedChange={(notifyWhenAnswered) =>
              void notifications.update('notifyWhenAnswered', { notifyWhenAnswered })
            }
          />
        )}
        <SaveStatus state={notifications.saveState} field="notifyWhenAnswered" />
      </Section>

      <Section
        title="Use CareLayer in Claude"
        description="Ask a nurse from a chat with Claude. Claude pays from this wallet, within its own limit."
      >
        <Alert tone="info">
          Connecting to Claude is not available yet. The connection steps and link will appear here
          when it is ready. You can set its limits now.
        </Alert>
        {settingsLoading}
        {settingsUnavailable}
        {settings.current && (
          <>
            <LimitChips
              label="Claude spending limit per answer"
              value={settings.current.mcpSpendingLimitPerAnswerKobo}
              onChange={(kobo) =>
                void settings.update('mcpSpendingLimitPerAnswerKobo', {
                  mcpSpendingLimitPerAnswerKobo: kobo,
                })
              }
            />
            <SaveStatus state={settings.saveState} field="mcpSpendingLimitPerAnswerKobo" />
            <Toggle
              label="Ask me before each payment"
              description="Claude checks with you before paying for any answer."
              checked={settings.current.mcpAskBeforeEachPayment}
              onCheckedChange={(mcpAskBeforeEachPayment) =>
                void settings.update('mcpAskBeforeEachPayment', { mcpAskBeforeEachPayment })
              }
            />
            <SaveStatus state={settings.saveState} field="mcpAskBeforeEachPayment" />
          </>
        )}
      </Section>

      <Section title="Add to Home Screen">
        <details className={styles.details}>
          <summary className={styles.summary}>How to add CareLayer to your phone</summary>
          <div className={styles.detailsBody}>
            <p className={styles.stepTitle}>iPhone (Safari)</p>
            <ol className={styles.steps}>
              <li>Tap the Share button.</li>
              <li>Choose “Add to Home Screen”, then “Add”.</li>
              <li>Open CareLayer from your home screen. You may need to log in once there.</li>
            </ol>
            <p className={styles.stepTitle}>Android (Chrome)</p>
            <ol className={styles.steps}>
              <li>Tap the ⋮ menu.</li>
              <li>Choose “Install app” or “Add to Home screen”.</li>
            </ol>
          </div>
        </details>
      </Section>

      <SignOut />
    </div>
  );
}

function Section({
  title,
  description,
  hideTitle = false,
  children,
}: {
  title: string;
  description?: string;
  /** The control inside already shows the title (e.g. Appearance legend). */
  hideTitle?: boolean;
  children: ReactNode;
}) {
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section className={styles.card} aria-labelledby={id}>
      <div className={hideTitle ? 'visually-hidden' : styles.sectionHead}>
        <h2 id={id} className={styles.sectionTitle}>
          {title}
        </h2>
        {description && !hideTitle && <p className={styles.muted}>{description}</p>}
      </div>
      {children}
    </section>
  );
}

function LimitChips({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (kobo: number) => void;
}) {
  // Keep a value set elsewhere (another device, Claude) visible and selected.
  const options: number[] = (LIMIT_PRESETS_KOBO as readonly number[]).includes(value)
    ? [...LIMIT_PRESETS_KOBO]
    : [...LIMIT_PRESETS_KOBO, value].sort((a, b) => a - b);
  return (
    <div className={styles.chips} role="group" aria-label={label}>
      {options.map((kobo) => (
        <Chip key={kobo} selected={value === kobo} onClick={() => onChange(kobo)}>
          {limitLabel(kobo)}
        </Chip>
      ))}
    </div>
  );
}

/** "Saving…" / "Saved" / error for one field, announced politely. */
function SaveStatus({ state, field }: { state: SaveState; field: string }) {
  const mine = state.status !== 'idle' && state.field === field;
  if (mine && state.status === 'error') {
    return (
      <Alert tone="error">
        {loadErrorMessage(state.error, 'We could not save that change. Please try again.')}
      </Alert>
    );
  }
  return (
    <p className={styles.status} role="status">
      {mine ? (state.status === 'saving' ? 'Saving…' : 'Saved.') : ''}
    </p>
  );
}

/** Log out (this device) and Log out of all devices (asks first; only says done when it is). */
function SignOut() {
  const { logout, logoutAll } = useAuth();
  const [busy, setBusy] = useState<'one' | 'all' | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [error, setError] = useState<string>();

  const handleLogout = async () => {
    setBusy('one');
    // Never rejects; RequireAuth then takes her to the Welcome page.
    await logout();
  };

  const handleLogoutAll = async () => {
    setBusy('all');
    setError(undefined);
    try {
      await logoutAll();
    } catch (caught) {
      setBusy(null);
      setError(
        loadErrorMessage(
          caught,
          'We could not log you out of your other devices. You are still logged in here. Please try again.',
        ),
      );
    }
  };

  return (
    <section className={styles.signOut} aria-label="Log out">
      <Button
        variant="secondary"
        onClick={handleLogout}
        disabled={busy !== null}
        aria-busy={busy === 'one' || undefined}
        className={styles.logout}
      >
        {busy === 'one' ? 'Logging out…' : 'Log out'}
      </Button>

      {confirmAll ? (
        <div className={styles.confirm}>
          <p className={styles.confirmText}>
            This logs you out on every phone and computer, including this one.
          </p>
          <div className={styles.actions}>
            <Button
              onClick={handleLogoutAll}
              disabled={busy !== null}
              aria-busy={busy === 'all' || undefined}
            >
              {busy === 'all' ? 'Logging out…' : 'Log out everywhere'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setConfirmAll(false)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          onClick={() => setConfirmAll(true)}
          disabled={busy !== null}
          className={styles.logout}
        >
          Log out of all devices
        </Button>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </section>
  );
}
