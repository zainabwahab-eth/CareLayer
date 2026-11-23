import { QUESTION_CATEGORIES, type QuestionCategory } from '@carelayer/shared';
import { Alert } from '@web/components/Alert/Alert';
import { Button, ButtonLink } from '@web/components/Button/Button';
import { Chip } from '@web/components/Chip/Chip';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import { categoryLabel } from '@web/utils/categories';
import { formatListDate } from '@web/utils/dates';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useReadyProfile } from '../onboarding/profile-context';
import { casePath, casesPath, type CasesTab } from '../routes/paths';
import { CaseCard, CaseTags, EmptyState, LoadError, Skeleton } from '../workspace/components';
import { formatCountdown, msUntil } from '../workspace/format';
import { useNow, useNurseQuery, useNursePaged } from '../workspace/hooks';
import styles from '../workspace/workspace.module.css';

/*
 * N06 Cases (Figma: Nurse -mobile / N06). GET /nurse/questions?tab=waiting|active|completed.
 * Waiting refreshes every 30 s. The topic chips filter on this device: the API shows
 * every eligible question whatever her topics (topics only control alerts, contract §9).
 */

const TABS: ReadonlyArray<{ key: CasesTab; label: string }> = [
  { key: 'waiting', label: 'Waiting' },
  { key: 'active', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
];

type TopicFilter = 'all' | 'mine' | QuestionCategory;

function readTab(value: string | null): CasesTab {
  return value === 'active' || value === 'completed' ? value : 'waiting';
}

export function CasesPage() {
  const [params] = useSearchParams();
  const tab = readTab(params.get('tab'));
  const { profile } = useReadyProfile();
  const now = useNow();
  const waiting = useNurseQuery((api) => api.cases.list('waiting', { limit: 50 }), [], {
    pollMs: 30_000,
  });
  const active = useNurseQuery((api) => api.cases.list('active'), [tab]);
  const [topic, setTopic] = useState<TopicFilter>('all');

  const waitingItems = waiting.data?.items ?? [];
  const filtered = waitingItems.filter((q) =>
    topic === 'all'
      ? true
      : topic === 'mine'
        ? profile.topics.includes(q.category)
        : q.category === topic,
  );
  const counts: Partial<Record<CasesTab, number>> = {
    waiting: waiting.data?.items.length,
    active: active.data?.items.length,
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Cases</h1>
      </header>

      <nav aria-label="Case lists" className={styles.segments}>
        {TABS.map((t) => (
          <Link
            key={t.key}
            to={casesPath(t.key)}
            className={cx(styles.segment, tab === t.key && styles.segmentActive)}
            aria-current={tab === t.key ? 'page' : undefined}
          >
            {t.label}
            {counts[t.key] !== undefined && <span className={styles.muted}>{counts[t.key]}</span>}
          </Link>
        ))}
      </nav>

      {tab === 'waiting' && (
        <>
          <div className={styles.chips} role="group" aria-label="Filter by topic">
            <Chip selected={topic === 'all'} onClick={() => setTopic('all')}>
              All
            </Chip>
            <Chip selected={topic === 'mine'} onClick={() => setTopic('mine')}>
              My topics
            </Chip>
            {QUESTION_CATEGORIES.map((c) => (
              <Chip key={c} selected={topic === c} onClick={() => setTopic(c)}>
                {categoryLabel(c)}
              </Chip>
            ))}
          </div>
          <Alert tone="info">One case at a time. You have 10 minutes once you claim.</Alert>
          {waiting.status === 'loading' && <Skeleton count={3} height="10rem" />}
          {waiting.status === 'error' && (
            <LoadError
              error={waiting.error}
              fallback="We could not load waiting questions."
              onRetry={waiting.reload}
            />
          )}
          {waiting.status === 'success' && filtered.length === 0 && (
            <EmptyState
              title={waitingItems.length ? 'Nothing in this topic' : 'No one is waiting right now'}
              action={
                waitingItems.length ? (
                  <Button variant="secondary" onClick={() => setTopic('all')}>
                    Show all topics
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={waiting.reload}>
                    Check again
                  </Button>
                )
              }
            >
              {waitingItems.length
                ? 'Other questions are waiting in other topics.'
                : 'New questions appear here as women ask them. Questions close 30 minutes after she asks.'}
            </EmptyState>
          )}
          {filtered.map((q) => (
            <CaseCard key={q.id} question={q} now={now} />
          ))}
        </>
      )}

      {tab === 'active' && (
        <>
          {active.status === 'loading' && <Skeleton count={1} height="10rem" />}
          {active.status === 'error' && (
            <LoadError
              error={active.error}
              fallback="We could not load your question in progress."
              onRetry={active.reload}
            />
          )}
          {active.status === 'success' && active.data.items.length === 0 && (
            <EmptyState
              icon="chat"
              title="No question in progress"
              action={<ButtonLink to={casesPath()}>Find a question</ButtonLink>}
            >
              Claim a waiting question to answer it. You have 10 minutes once you claim.
            </EmptyState>
          )}
          {active.data?.items.map((q) => {
            const left = msUntil(q.claimExpiresAt, now);
            return (
              <article key={q.id} className={styles.accentCard} aria-label="Question in progress">
                <div className={styles.row}>
                  <CaseTags question={q} />
                  <span className={cx(styles.timer, left < 120_000 && styles.timerUrgent)}>
                    <Icon name="clock" size={16} />
                    {left > 0 ? `${formatCountdown(left)} left` : 'Time is up'}
                  </span>
                </div>
                <p className={styles.body}>{q.cleanedText}</p>
                {left > 0 ? (
                  <ButtonLink to={casePath(q.id)} fullWidth>
                    Continue answering
                  </ButtonLink>
                ) : (
                  <p className={cx(styles.bodySmall, styles.muted)}>
                    Your 10 minutes ran out. The question is open to others again.
                  </p>
                )}
              </article>
            );
          })}
        </>
      )}

      {tab === 'completed' && <CompletedList />}
    </div>
  );
}

function CompletedList() {
  const done = useNursePaged((api, cursor) => api.cases.list('completed', { cursor }));
  if (done.status === 'loading') return <Skeleton count={3} height="6rem" />;
  if (done.status === 'error') {
    return (
      <LoadError
        error={done.error}
        fallback="We could not load your completed answers."
        onRetry={done.reload}
      />
    );
  }
  if (done.items.length === 0) {
    return (
      <EmptyState icon="check" title="No answers yet">
        Questions you answer are listed here.
      </EmptyState>
    );
  }
  return (
    <>
      <ul role="list" className={styles.page} style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {done.items.map((q) => (
          <li key={q.id}>
            <Link
              to={casePath(q.id)}
              className={styles.card}
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              <div className={styles.row}>
                <CaseTags question={q} />
                <span className={styles.meta}>
                  <Icon name="check" size={16} />
                  Answered
                </span>
              </div>
              <p className={styles.body}>{q.cleanedText}</p>
              <span className={styles.meta}>Asked {formatListDate(q.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {done.loadMoreError && <Alert tone="error">We could not load more. Try again.</Alert>}
      {done.hasMore && (
        <Button variant="secondary" onClick={done.loadMore} disabled={done.loadingMore}>
          {done.loadingMore ? 'Loading…' : 'Show more'}
        </Button>
      )}
    </>
  );
}
