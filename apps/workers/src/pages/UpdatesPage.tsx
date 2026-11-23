import { Button } from '@web/components/Button/Button';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import { Link } from 'react-router';
import { useReadyProfile } from '../onboarding/profile-context';
import { EmptyState, LoadError, Skeleton } from '../workspace/components';
import { useNow } from '../workspace/hooks';
import { useUpdates } from '../workspace/updates';
import styles from '../workspace/workspace.module.css';

/*
 * Updates: the notification centre (no frame). Worked out from her live data,
 * because apps/api has no notification feed for nurses (docs/QUESTIONS.md Q6).
 * Read/unread is kept on this device. Each update opens what it is about.
 */
export function UpdatesPage() {
  const { profile } = useReadyProfile();
  const now = useNow(5_000);
  const { status, error, updates, isRead, unreadCount, markRead, reload } = useUpdates(
    profile,
    now,
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Updates</h1>
        {unreadCount > 0 && (
          <Button variant="ghost" onClick={() => markRead(updates.map((u) => u.id))}>
            Mark all as read
          </Button>
        )}
      </header>
      <p className={styles.lede}>
        {unreadCount > 0 ? `${unreadCount} unread` : 'You are up to date.'} New questions,
        deadlines, payments and account news.
      </p>

      {status === 'loading' && <Skeleton count={4} height="4.5rem" />}
      {status === 'error' && (
        <LoadError error={error} fallback="We could not load your updates." onRetry={reload} />
      )}
      {status === 'success' && updates.length === 0 && (
        <EmptyState icon="bell" title="Nothing new">
          We’ll show new questions in your topics, deadlines and payments here.
        </EmptyState>
      )}
      {status === 'success' && updates.length > 0 && (
        <ul
          role="list"
          className={styles.page}
          style={{ margin: 0, padding: 0, listStyle: 'none', gap: 'var(--space-8)' }}
        >
          {updates.map((u) => {
            const read = isRead(u.id);
            return (
              <li key={u.id}>
                <Link
                  to={u.to}
                  onClick={() => markRead([u.id])}
                  className={cx(styles.card, u.urgent && !read && styles.accentCard)}
                  style={{
                    color: 'inherit',
                    textDecoration: 'none',
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                  }}
                  aria-label={`${read ? '' : 'Unread: '}${u.title}. ${u.detail}`}
                >
                  <span className={styles.listIcon} aria-hidden>
                    <Icon name={u.icon} size={18} />
                  </span>
                  <span className={styles.stack} style={{ flex: 1 }}>
                    <span className={cx(styles.label, read && styles.muted)}>{u.title}</span>
                    <span className={cx(styles.bodySmall, styles.muted)}>{u.detail}</span>
                  </span>
                  {!read && <span className={styles.dot} aria-hidden />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className={cx(styles.caption, styles.muted)}>
        Questions chosen for you, and new questions in your topics while you’re available, are also
        emailed to you.
      </p>
    </div>
  );
}
