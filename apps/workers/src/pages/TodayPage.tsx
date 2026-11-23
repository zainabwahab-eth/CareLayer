import { isSessionError } from '@web/auth/auth-flow';
import { Alert } from '@web/components/Alert/Alert';
import { Avatar } from '@web/components/Avatar/Avatar';
import { Badge } from '@web/components/Badge/Badge';
import { ButtonLink } from '@web/components/Button/Button';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import { Toggle } from '@web/components/Toggle/Toggle';
import { categoryLabel } from '@web/utils/categories';
import { formatNaira } from '@web/utils/money';
import { useState } from 'react';
import { Link } from 'react-router';
import { useNurseApi } from '../api/api-context';
import { useAuth } from '../auth/useAuth';
import { useReadyProfile } from '../onboarding/profile-context';
import { casePath, casesPath, paths } from '../routes/paths';
import { CaseCard, LoadError, Skeleton } from '../workspace/components';
import { firstName, formatCountdown, greeting, msUntil, roleLabel } from '../workspace/format';
import { useNow, useNurseQuery } from '../workspace/hooks';
import { buildUpdates, useReadState } from '../workspace/updates';
import styles from '../workspace/workspace.module.css';

/*
 * N05 Today (Figma: Nurse -mobile / N05). GET /nurse/dashboard, GET /nurse/questions
 * (waiting), GET /nurse/earnings, PATCH /nurse/preferences { available }.
 * Refreshes every 30 s while open, so new questions and the claim countdown stay current.
 */
export function TodayPage() {
  const api = useNurseApi();
  const { sessionExpired } = useAuth();
  const { profile, setProfile } = useReadyProfile();
  const now = useNow();
  const poll = { pollMs: 30_000 };
  const dashboard = useNurseQuery((a) => a.cases.dashboard(), [], poll);
  const waiting = useNurseQuery((a) => a.cases.list('waiting', { limit: 20 }), [], poll);
  const earnings = useNurseQuery((a) => a.earnings.get(), [], poll);
  const readState = useReadState(profile.userId);
  const [saving, setSaving] = useState(false);
  const [toggleError, setToggleError] = useState<string>();

  const setAvailable = async (available: boolean) => {
    setSaving(true);
    setToggleError(undefined);
    try {
      setProfile(await api.nurse.updatePreferences({ available }));
      dashboard.reload();
    } catch (error) {
      if (isSessionError(error)) sessionExpired();
      setToggleError('We could not change your availability. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const topics = profile.topics.map((t) => categoryLabel(t).toLowerCase());
  const topicsText =
    topics.length > 2
      ? `${topics.slice(0, -1).join(', ')} and ${topics.at(-1)}`
      : topics.join(' and ');
  const today = earnings.data?.thisWeek.days.find((d) => d.isToday);
  const claim = dashboard.data?.activeClaim ?? null;
  const claimLeft = claim ? msUntil(claim.claimExpiresAt, now) : 0;
  const preview = waiting.data?.items.slice(0, 2) ?? [];
  const waitingCount = dashboard.data?.waitingCount ?? waiting.data?.items.length ?? 0;
  // The bell's badge, from the data this screen already loaded (no extra requests).
  const unreadCount = buildUpdates({
    profile,
    dashboard: dashboard.data,
    waiting: waiting.data?.items,
    earnings: earnings.data,
    now,
  }).filter((u) => !readState.isRead(u.id)).length;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.rowStart}>
          <Avatar name={profile.fullName} size={52} decorative />
          <div className={styles.stack}>
            <h1 className={styles.titleSmall}>
              {greeting()}, {firstName(profile.fullName)}
            </h1>
            <span>
              <Badge variant="verified">Verified {roleLabel(profile.role).toLowerCase()}</Badge>
            </span>
          </div>
        </div>
        <Link
          to={paths.updates}
          className={styles.link}
          aria-label={unreadCount > 0 ? `Updates, ${unreadCount} unread` : 'Updates'}
        >
          <span className={styles.rowStart} style={{ gap: 'var(--space-4)' }}>
            <Icon name="bell" size={24} />
            {unreadCount > 0 && <span className={styles.dot} aria-hidden />}
          </span>
        </Link>
      </header>

      <section className={styles.primaryCard} aria-label="Availability">
        <Toggle
          checked={profile.available}
          onCheckedChange={(next) => void setAvailable(next)}
          disabled={saving}
          label={profile.available ? 'You’re available' : 'You’re unavailable'}
          description={
            profile.available
              ? `New ${topicsText} cases will alert you.`
              : 'Turn on to get alerts for new cases. You can still answer waiting ones.'
          }
        />
        {toggleError && <Alert tone="error">{toggleError}</Alert>}
      </section>

      {dashboard.status === 'error' && (
        <LoadError
          error={dashboard.error}
          fallback="We could not load today’s summary."
          onRetry={dashboard.reload}
        />
      )}

      <section className={styles.stats} aria-label="Today at a glance">
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {earnings.status === 'success' ? formatNaira(today?.total ?? 0) : '…'}
          </span>
          <span className={styles.statLabel}>Earned today</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {dashboard.data ? dashboard.data.answeredToday : '…'}
          </span>
          <span className={styles.statLabel}>Answered today</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {dashboard.data
              ? dashboard.data.avgResponseMinutes === null
                ? '–'
                : `${dashboard.data.avgResponseMinutes} min`
              : '…'}
          </span>
          <span className={styles.statLabel}>Avg. reply</span>
        </div>
      </section>
      {dashboard.data?.helpful.percent != null && (
        <p className={cx(styles.bodySmall, styles.muted)}>
          {dashboard.data.helpful.percent}% helpful ({dashboard.data.helpful.count}) ·{' '}
          {dashboard.data.answeredThisWeek} answered this week
        </p>
      )}

      {claim && claimLeft > 0 && (
        <section className={styles.accentCard} aria-label="Your active case">
          <div className={styles.row}>
            <span className={styles.label}>Your active case</span>
            <span className={cx(styles.timer, claimLeft < 120_000 && styles.timerUrgent)}>
              <Icon name="clock" size={16} />
              {formatCountdown(claimLeft)} left
            </span>
          </div>
          <p className={styles.body}>{claim.cleanedText}</p>
          <ButtonLink to={casePath(claim.id)} fullWidth>
            Continue answering
          </ButtonLink>
        </section>
      )}

      <section className={styles.stack} style={{ gap: 'var(--space-12)' }}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Waiting for a nurse</h2>
          {waitingCount > 0 && (
            <Link to={casesPath()} className={styles.link}>
              See all {waitingCount}
            </Link>
          )}
        </div>
        {waiting.status === 'loading' && <Skeleton count={1} height="9rem" />}
        {waiting.status === 'error' && (
          <LoadError
            error={waiting.error}
            fallback="We could not load waiting questions."
            onRetry={waiting.reload}
          />
        )}
        {waiting.status === 'success' && preview.length === 0 && (
          <p className={cx(styles.bodySmall, styles.muted)}>
            No one is waiting right now. New questions appear here as women ask them.
          </p>
        )}
        {preview.map((q) => (
          <CaseCard key={q.id} question={q} now={now} />
        ))}
      </section>

      <section className={styles.card} aria-label="Earnings summary">
        <div className={styles.row}>
          <h2 className={styles.cardTitle}>Earnings</h2>
          <Link to={paths.earnings} className={styles.link}>
            Open
          </Link>
        </div>
        {earnings.status === 'loading' && <Skeleton count={1} height="3rem" />}
        {earnings.status === 'error' && (
          <LoadError
            error={earnings.error}
            fallback="We could not load your earnings."
            onRetry={earnings.reload}
          />
        )}
        {earnings.data && (
          <>
            <div className={styles.row}>
              <span className={styles.muted}>Available to withdraw</span>
              <span className={styles.label}>{formatNaira(earnings.data.available)}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.muted}>This week</span>
              <span className={styles.label}>
                {formatNaira(earnings.data.thisWeek.total)} from{' '}
                {earnings.data.thisWeek.answersCount} answers
              </span>
            </div>
          </>
        )}
      </section>

      <section aria-label="Quick actions" className={styles.actions}>
        <ButtonLink to={casesPath()} variant="secondary">
          Find a question
        </ButtonLink>
        <ButtonLink to={paths.withdraw} variant="secondary">
          Withdraw
        </ButtonLink>
        <ButtonLink to={paths.profile} variant="secondary">
          Edit topics
        </ButtonLink>
      </section>
    </div>
  );
}
