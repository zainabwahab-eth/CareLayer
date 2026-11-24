import {
  FREE_ANSWERS_PER_WOMAN,
  type MyQuestion,
  type Page,
  type WalletResponse,
} from '@carelayer/shared';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { loadErrorMessage } from '../../api/error-message';
import { useApiQuery, type ApiQueryResult } from '../../api/useApiQuery';
import { useAuth } from '../../auth/useAuth';
import { useSessionGuard } from '../../auth/useSessionGuard';
import type { EmergencyLocationState } from '../../chat/emergency-state';
import { useChat } from '../../chat/useChat';
import { CHAT_MESSAGE_MAX_LENGTH } from '../../chat/chat-context';
import { Alert } from '../../components/Alert/Alert';
import { Avatar } from '../../components/Avatar/Avatar';
import { Badge } from '../../components/Badge/Badge';
import { Button, ButtonLink } from '../../components/Button/Button';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon/Icon';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { InstallBanner } from '../../pwa/InstallBanner';
import { consultationWaitingPath, paths } from '../../routes/paths';
import { formatLongDay, formatTimeAgo, greeting } from '../../utils/dates';
import { formatNaira } from '../../utils/money';
import { nurseLine } from '../../utils/nurses';
import type { AskPrefillState } from './ask/ask-prefill';
import {
  costLabel,
  isInReview,
  nurseLabel,
  questionLink,
  questionTitle,
  statusBadge,
} from './history/question-display';
import styles from './HomePage.module.css';

/** Rows in "Recent consultations" (Figma shows three). */
const RECENT_COUNT = 3;

/** W05 mobile "Start with a topic": opens the chat with a few words to finish. */
const TOPICS: ReadonlyArray<{ label: string; prefill?: string }> = [
  { label: 'Pregnancy', prefill: 'I have a question about pregnancy: ' },
  { label: 'Periods', prefill: 'I have a question about my period: ' },
  { label: 'Contraception', prefill: 'I have a question about contraception: ' },
  { label: 'Sexual health', prefill: 'I have a question about sexual health: ' },
  { label: 'Others' },
];

/**
 * W05 Home (Figma: "W05 Home", "D-W05 Home", "D-W05 Home - empty").
 *   Desktop: greeting + date, bell, quick exit. Left: Ask card, Recent consultations.
 *   Right: active consultation (if any), balance + free answers, Private by default,
 *   then Add to Home Screen.
 *   Mobile: greeting, Ask card, active consultation, stats, Start with a topic,
 *   Private by default (not in the mobile frame; asked for on both), Add to Home Screen.
 * Data: GET /me/questions, GET /wallet.
 */
export function HomePage() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const { state } = useAuth();
  const name = state.user?.displayName ?? '';
  const questions = useApiQuery((api) => api.questions.listMine({ limit: 20 }));
  const wallet = useApiQuery((api) => api.wallet.get());
  useSessionGuard(questions.error, wallet.error);

  const items = questions.data?.items ?? [];
  const active = items.find(isInReview) ?? null;
  const recent = items.filter((q) => !isInReview(q)).slice(0, RECENT_COUNT);
  // An answer is waiting to be opened (answered, not yet collected): the bell shows a dot.
  const answerWaiting = items.some((q) => q.status === 'answered' && q.answer === null);
  const hello = greeting();

  const bell = (
    <Link
      to={paths.consultations}
      className={styles.bell}
      aria-label={
        answerWaiting ? 'Consultations: an answer is ready to open' : 'Your consultations'
      }
    >
      <Icon name="bell" size={24} />
      {answerWaiting && <span className={styles.bellDot} aria-hidden />}
    </Link>
  );

  const header = isDesktop ? (
    <PageHeader title={`${hello}, ${name}`} subtitle={formatLongDay()} actions={bell} />
  ) : (
    <PageHeader eyebrow={`${hello},`} title={name} />
  );

  const stats = <Stats wallet={wallet} />;
  const activeCard = active && <ActiveConsultation question={active} compact={!isDesktop} />;
  const privacy = (
    <section className={styles.privacy} aria-labelledby="home-privacy">
      <h2 id="home-privacy" className={styles.privacyTitle}>
        <Icon name="lock" size={20} />
        Private by default
      </h2>
      <p className={styles.privacyText}>
        Nurses never see your name, email, phone number or location. Press Esc twice anytime to
        leave quickly.
      </p>
    </section>
  );

  if (!isDesktop) {
    return (
      <div className={styles.page}>
        {header}
        <AskCard compact />
        {activeCard}
        {stats}
        <Topics />
        {privacy}
        <InstallBanner />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {header}
      <div className={styles.grid}>
        <div className={styles.left}>
          <AskCard />
          <RecentConsultations questions={recent} query={questions} />
        </div>
        <div className={styles.right}>
          {activeCard}
          {stats}
          {privacy}
          <InstallBanner />
        </div>
      </div>
    </div>
  );
}

/** "What's on your mind?": her question goes straight to the assistant in a new chat. */
function AskCard({ compact = false }: { compact?: boolean }) {
  const chat = useChat();
  const navigate = useNavigate();
  const fieldId = useId();
  const [text, setText] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = text.trim();
    if (!question) {
      navigate(paths.ask);
      return;
    }
    // A question from Home starts a new chat, then the chat screen shows the reply.
    chat.reset();
    navigate(paths.ask);
    void chat.send(question).then((result) => {
      if (result.kind === 'emergency') {
        const state: EmergencyLocationState = { emergency: result.response };
        navigate(paths.emergency, { state });
      }
    });
  };

  return (
    <section
      className={cx(styles.askCard, compact && styles.askCompact)}
      aria-labelledby={`${fieldId}-title`}
    >
      <h2 id={`${fieldId}-title`} className={styles.askTitle}>
        What’s on your mind?
      </h2>
      <p className={styles.askText}>
        Periods, pregnancy, contraception, sex. Ask privately; a nurse steps in when you need one.
      </p>
      <form className={styles.field} onSubmit={submit}>
        <label htmlFor={fieldId} className="visually-hidden">
          Your question
        </label>
        <input
          id={fieldId}
          className={styles.input}
          placeholder="Type your question…"
          value={text}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          onChange={(event) => setText(event.target.value)}
          autoComplete="off"
        />
        <button type="submit" className={styles.send} aria-label="Ask the assistant">
          <Icon name="send" size={compact ? 20 : 22} />
        </button>
      </form>
    </section>
  );
}

/** Her open question (waiting for, or with, a nurse). Figma "Active consultation". */
function ActiveConsultation({ question, compact }: { question: MyQuestion; compact: boolean }) {
  const nurse = question.chosenNurse;
  const role = nurse?.role === 'midwife' ? 'Midwife' : 'Nurse';
  const label = question.status === 'claimed' ? `${role} reviewing` : 'Waiting for a nurse';
  // No live progress from the API: waiting is a third of the way, reviewing two thirds.
  const progress = question.status === 'claimed' ? 66 : 33;

  const body = (
    <>
      <span className={styles.activeTop}>
        <Badge variant="accent">{label}</Badge>
        <time dateTime={question.createdAt} className={styles.caption}>
          {formatTimeAgo(question.createdAt)}
        </time>
      </span>
      <span className={cx(styles.activeTitle, compact && styles.activeTitleCompact)}>
        {questionTitle(question)}
      </span>
      <span className={styles.who}>
        {nurse && <Avatar name={nurse.displayName} size={32} decorative />}
        <span className={styles.small}>{nurse ? nurseLine(nurse) : nurseLabel(question)}</span>
      </span>
      <span
        className={styles.progress}
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span className={styles.progressBar} style={{ width: `${progress}%` }} />
      </span>
    </>
  );

  // Mobile: the whole card opens the status. Desktop: a "View status" button (Figma).
  return compact ? (
    <Link to={consultationWaitingPath(question.id)} className={cx(styles.card, styles.active)}>
      {body}
    </Link>
  ) : (
    <section className={cx(styles.card, styles.active)} aria-label="Your question in review">
      {body}
      <ButtonLink to={consultationWaitingPath(question.id)} variant="secondary" fullWidth>
        View status
      </ButtonLink>
    </section>
  );
}

function Stats({ wallet }: { wallet: ApiQueryResult<WalletResponse> }) {
  const free = wallet.data?.freeAnswersRemaining;
  return (
    <div className={styles.stats}>
      <div className={styles.stat}>
        <span className={styles.caption}>Balance</span>
        <span className={styles.statValue}>
          {wallet.data ? formatNaira(wallet.data.balance) : '–'}
        </span>
        <Link to={paths.wallet} className={styles.statLink}>
          Top up
        </Link>
      </div>
      <div className={styles.stat}>
        <span className={styles.caption}>Free answers</span>
        <span className={styles.statValue}>
          {free == null ? '–' : `${free} of ${FREE_ANSWERS_PER_WOMAN}`}
        </span>
        <span className={styles.statMuted}>left</span>
      </div>
    </div>
  );
}

function RecentConsultations({
  questions,
  query,
}: {
  questions: readonly MyQuestion[];
  query: ApiQueryResult<Page<MyQuestion>>;
}) {
  return (
    <section className={cx(styles.card, styles.recent)} aria-labelledby="home-recent">
      <div className={styles.recentHead}>
        <h2 id="home-recent" className={styles.recentTitle}>
          Recent consultations
        </h2>
        <Link to={paths.consultations} className={styles.statLink}>
          View all
        </Link>
      </div>

      {query.status === 'loading' && (
        <p className={styles.recentEmpty} role="status">
          Loading…
        </p>
      )}
      {query.status === 'error' && (
        <div className={styles.recentEmpty}>
          <Alert tone="error">
            {loadErrorMessage(query.error, 'We could not load your consultations.')}
          </Alert>
          <Button variant="secondary" onClick={query.reload}>
            Try again
          </Button>
        </div>
      )}
      {query.status === 'success' && questions.length === 0 && (
        <p className={styles.recentEmpty}>No recent consultations</p>
      )}
      {questions.length > 0 && (
        <ul role="list" className={styles.rows}>
          {questions.map((q) => {
            const badge = statusBadge(q);
            return (
              <li key={q.id}>
                <Link to={questionLink(q)} className={styles.row}>
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>{questionTitle(q)}</span>
                    <span className={styles.small}>{nurseLabel(q)}</span>
                  </span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className={styles.rowCost}>{costLabel(q)}</span>
                  <Icon name="chevron" size={18} className={styles.chevron} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Mobile "Start with a topic": each chip opens the chat with a starter to finish. */
function Topics() {
  return (
    <section className={styles.topics} aria-labelledby="home-topics">
      <h2 id="home-topics" className={styles.topicsTitle}>
        Start with a topic
      </h2>
      <ul role="list" className={styles.chips}>
        {TOPICS.map((topic) => {
          const state: AskPrefillState | undefined = topic.prefill
            ? { prefill: topic.prefill }
            : undefined;
          return (
            <li key={topic.label}>
              <Link
                to={paths.ask}
                state={state}
                className={cx(styles.chip, !topic.prefill && styles.chipStrong)}
              >
                {topic.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
