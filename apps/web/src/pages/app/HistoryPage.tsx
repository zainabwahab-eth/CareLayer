import type { MyQuestion } from '@carelayer/shared';
import { useDeferredValue, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { loadErrorMessage } from '../../api/error-message';
import { usePagedQuery } from '../../api/usePagedQuery';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { Alert } from '../../components/Alert/Alert';
import { Badge } from '../../components/Badge/Badge';
import { Button, ButtonLink } from '../../components/Button/Button';
import { Chip } from '../../components/Chip/Chip';
import { Icon } from '../../components/Icon/Icon';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { paths } from '../../routes/paths';
import { formatFullDate, formatListDate } from '../../utils/dates';
import { formatNaira } from '../../utils/money';
import styles from './HistoryPage.module.css';
import { ChatHistory } from './history/ChatHistory';
import {
  HISTORY_FILTERS,
  costLabel,
  formatMinutes,
  historyStats,
  matchesFilter,
  nurseLabel,
  plural,
  questionLink,
  questionTitle,
  statusBadge,
  type HistoryFilter,
} from './history/question-display';

/** Contract max page size: most women have every question in the first page. */
const PAGE_SIZE = 100;

const EMPTY_FILTER_TEXT: Record<HistoryFilter, string> = {
  all: '',
  answered: 'No answered questions yet.',
  in_review: 'Nothing is waiting for a nurse right now.',
};

/** History tabs: questions sent to nurses (W12) and saved assistant chats. */
export type HistoryTab = 'questions' | 'chats';
const TAB_PARAM = 'tab';

/**
 * History: two tabs.
 *   Nurse questions: W12 (Figma: W12 History 8:232 / D-W12 History 26:673), GET /me/questions.
 *   Assistant chats: her saved chats (no Figma frame; built from the W12 card pattern),
 *   GET /chat/conversations.
 * The tab is in the URL (?tab=chats) so Back and reload keep it.
 */
export function HistoryPage() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: HistoryTab = searchParams.get(TAB_PARAM) === 'chats' ? 'chats' : 'questions';

  const header = (
    <PageHeader
      title="History"
      subtitle={
        isDesktop
          ? tab === 'chats'
            ? 'Your chats with the assistant. Only you can see them.'
            : 'Every question you’ve sent to a nurse, with answers and receipts.'
          : undefined
      }
    />
  );
  const tabs = (
    <div className={styles.tabs} role="group" aria-label="Show">
      <Chip selected={tab === 'questions'} onClick={() => setSearchParams({}, { replace: true })}>
        Nurse questions
      </Chip>
      <Chip
        selected={tab === 'chats'}
        onClick={() => setSearchParams({ [TAB_PARAM]: 'chats' }, { replace: true })}
      >
        Assistant chats
      </Chip>
    </div>
  );
  const top = (
    <>
      {header}
      {tabs}
    </>
  );

  return tab === 'chats' ? (
    <div className={styles.page}>
      {top}
      <ChatHistory />
    </div>
  ) : (
    <QuestionHistory top={top} />
  );
}

/** The W12 list of questions sent to nurses. */
function QuestionHistory({ top }: { top: ReactNode }) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const questions = usePagedQuery((api, cursor) =>
    api.questions.listMine({ cursor, limit: PAGE_SIZE }),
  );
  useSessionGuard(questions.error, questions.loadMoreError);

  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const searchId = useId();

  // Search is only offered on desktop (Figma); ignore a leftover query on mobile.
  const activeSearch = isDesktop ? deferredSearch : '';
  const visible = useMemo(
    () =>
      questions.items.filter(
        (q) =>
          matchesFilter(q, filter) &&
          (!activeSearch ||
            q.cleanedText.toLowerCase().includes(activeSearch) ||
            q.originalText.toLowerCase().includes(activeSearch)),
      ),
    [questions.items, filter, activeSearch],
  );
  // Stats need her whole list; hide them rather than show a partial count.
  const stats =
    questions.status === 'success' && !questions.hasMore ? historyStats(questions.items) : null;

  const header = top;

  if (questions.status === 'loading') {
    return (
      <div className={styles.page}>
        {header}
        <p className={styles.message} role="status">
          Loading your questions…
        </p>
      </div>
    );
  }

  if (questions.status === 'error') {
    return (
      <div className={styles.page}>
        {header}
        <Alert tone="error">
          {loadErrorMessage(questions.error, 'We could not load your questions.')}
        </Alert>
        <Button variant="secondary" onClick={questions.reload} className={styles.retry}>
          Try again
        </Button>
      </div>
    );
  }

  if (questions.items.length === 0) {
    return (
      <div className={styles.page}>
        {header}
        <section className={styles.empty} aria-labelledby={`${searchId}-empty`}>
          <h2 id={`${searchId}-empty`} className={styles.emptyTitle}>
            No questions yet
          </h2>
          <p className={styles.emptyText}>
            When you send a question to a nurse, it appears here with the answer and receipt.
          </p>
          <ButtonLink to={paths.ask}>Ask a question</ButtonLink>
        </section>
      </div>
    );
  }

  const filters = (
    <div className={styles.filters} role="group" aria-label="Show questions">
      {HISTORY_FILTERS.map((option) => (
        <Chip
          key={option.value}
          selected={filter === option.value}
          onClick={() => setFilter(option.value)}
        >
          {option.label}
        </Chip>
      ))}
    </div>
  );

  const emptyResult = activeSearch
    ? `No questions match “${search.trim()}”.`
    : EMPTY_FILTER_TEXT[filter];

  return (
    <div className={styles.page}>
      {header}

      {isDesktop && stats && <StatCards stats={stats} />}

      {isDesktop ? (
        <div className={styles.toolbar}>
          {filters}
          <div className={styles.search}>
            <Icon name="search" size={18} className={styles.searchIcon} />
            <label htmlFor={searchId} className="visually-hidden">
              Search your questions
            </label>
            <input
              id={searchId}
              type="search"
              className={styles.searchInput}
              placeholder="Search your questions"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
      ) : (
        <>
          {filters}
          {stats && (
            <p className={styles.summary}>
              {plural(stats.consultationsThisYear, 'consultation', 'consultations')} this year,{' '}
              {formatNaira(stats.spentThisYearKobo)} spent
            </p>
          )}
        </>
      )}

      <p className="visually-hidden" role="status">
        {plural(visible.length, 'question', 'questions')} shown
      </p>

      {visible.length === 0 ? (
        <p className={styles.message}>{emptyResult}</p>
      ) : isDesktop ? (
        <QuestionTable questions={visible} />
      ) : (
        <QuestionCards questions={visible} />
      )}

      {questions.loadMoreError && (
        <Alert tone="error">
          {loadErrorMessage(questions.loadMoreError, 'We could not load more questions.')}
        </Alert>
      )}
      {questions.hasMore && (
        <Button
          variant="secondary"
          onClick={questions.loadMore}
          disabled={questions.loadingMore}
          aria-busy={questions.loadingMore || undefined}
          className={styles.more}
        >
          {questions.loadingMore ? 'Loading…' : 'Show older questions'}
        </Button>
      )}
    </div>
  );
}

function StatCards({ stats }: { stats: ReturnType<typeof historyStats> }) {
  const items = [
    {
      value: String(stats.consultationsThisYear),
      label:
        stats.consultationsThisYear === 1 ? 'Consultation this year' : 'Consultations this year',
    },
    { value: formatNaira(stats.spentAllTimeKobo), label: 'Spent on answers' },
    {
      value: stats.averageAnswerMinutes === null ? '–' : formatMinutes(stats.averageAnswerMinutes),
      label: 'Average time to answer',
    },
    {
      value: String(stats.freeAnswersUsed),
      label: stats.freeAnswersUsed === 1 ? 'Free answer used' : 'Free answers used',
    },
  ];
  return (
    <dl className={styles.stats}>
      {items.map((item) => (
        <div key={item.label} className={styles.stat}>
          <dt className={styles.statLabel}>{item.label}</dt>
          <dd className={styles.statValue}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Mobile: Figma "Consultation / …" cards. The whole card opens the question. */
function QuestionCards({ questions }: { questions: readonly MyQuestion[] }) {
  return (
    <ul role="list" className={styles.cards}>
      {questions.map((q) => {
        const badge = statusBadge(q);
        const cost = costLabel(q);
        return (
          <li key={q.id}>
            <Link to={questionLink(q)} className={styles.card}>
              <span className={styles.cardTop}>
                <Badge variant={badge.variant}>{badge.label}</Badge>
                <time
                  dateTime={q.createdAt}
                  title={formatFullDate(q.createdAt)}
                  className={styles.cardDate}
                >
                  {formatListDate(q.createdAt, { weekday: true })}
                </time>
              </span>
              <span className={styles.cardTitle}>{questionTitle(q)}</span>
              <span className={styles.cardBottom}>
                <span className={styles.cardNurse}>{nurseLabel(q)}</span>
                <span className={cost.startsWith('Not') ? styles.costMuted : styles.cost}>
                  {cost}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Desktop: Figma "Table". The question cell holds the link; the whole row is clickable. */
function QuestionTable({ questions }: { questions: readonly MyQuestion[] }) {
  return (
    <div className={styles.tableCard}>
      <table className={styles.table}>
        <caption className="visually-hidden">Your questions, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Consultation</th>
            <th scope="col" className={styles.colNurse}>
              Health worker
            </th>
            <th scope="col" className={styles.colStatus}>
              Status
            </th>
            <th scope="col" className={styles.colDate}>
              Date
            </th>
            <th scope="col" className={styles.colCost}>
              Cost
            </th>
            <th scope="col" className={styles.colChevron}>
              <span className="visually-hidden">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q) => {
            const badge = statusBadge(q);
            return (
              <tr key={q.id} className={styles.row}>
                <td className={styles.titleCell}>
                  <Link to={questionLink(q)} className={styles.rowLink}>
                    {questionTitle(q)}
                  </Link>
                </td>
                <td className={styles.muted}>{nurseLabel(q)}</td>
                <td>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </td>
                <td className={styles.muted}>
                  <time dateTime={q.createdAt} title={formatFullDate(q.createdAt)}>
                    {formatListDate(q.createdAt)}
                  </time>
                </td>
                <td className={styles.muted}>{costLabel(q)}</td>
                <td className={styles.chevronCell}>
                  <Icon name="chevron" size={18} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
