import {
  CHOSEN_NURSE_WINDOW_MINUTES,
  type MyQuestion,
  type QuestionStatus,
} from '@carelayer/shared';
import type { ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useApiQuery } from '../../api/useApiQuery';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { Alert } from '../../components/Alert/Alert';
import { Badge } from '../../components/Badge/Badge';
import { Button, ButtonLink } from '../../components/Button/Button';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon/Icon';
import { consultationPath, paths } from '../../routes/paths';
import { categoryLabel } from '../../utils/categories';
import { formatFullDate, formatTime } from '../../utils/dates';
import { formatNaira } from '../../utils/money';
import { questionTitle } from './history/question-display';
import { FlowScreen } from './send/FlowScreen';
import styles from './send/flow.module.css';
import { QuestionLoadError, QuestionLoading } from './send/QuestionLoadStates';
import { useQuestionStatus } from './send/useQuestionStatus';

/*
 * W10 Waiting (Figma "W10 Waiting").
 *
 * Her question (GET /me/questions/:id) and its live status
 * (GET /questions/:id/status, polled every 5 s). Once answered she is taken to
 * W11. Expired and cancelled questions end here: she is never charged for them.
 * "Feeling worse while you wait?" goes to the free emergency screen: emergencies
 * never wait in the nurse queue.
 */
export function WaitingPage() {
  const { consultationId = '' } = useParams();
  const question = useApiQuery((api) => api.questions.getMine(consultationId), [consultationId]);
  const loadedStatus = question.data?.status;
  const inReview = loadedStatus === 'open' || loadedStatus === 'claimed';
  const poll = useQuestionStatus(consultationId, inReview);
  useSessionGuard(question.error, poll.error);

  if (question.status === 'loading') return <QuestionLoading />;
  if (question.status === 'error') {
    return <QuestionLoadError error={question.error} onRetry={question.reload} />;
  }

  const status: QuestionStatus = poll.data?.status ?? question.data.status;
  if (status === 'answered') return <Navigate to={consultationPath(consultationId)} replace />;

  return (
    <Waiting
      question={question.data}
      status={status}
      pollFailed={poll.error !== undefined}
      onCheckNow={poll.refresh}
    />
  );
}

interface WaitingProps {
  question: MyQuestion;
  status: Exclude<QuestionStatus, 'answered'>;
  pollFailed: boolean;
  onCheckNow: () => void;
}

function Waiting({ question, status, pollFailed, onCheckNow }: WaitingProps) {
  const ended = status === 'expired' || status === 'cancelled';

  return (
    <FlowScreen
      title="Consultation"
      subtitle={categoryLabel(question.category)}
      backTo={paths.history}
      backLabel="Back to history"
      footer={
        ended ? (
          <>
            <ButtonLink to={paths.ask} fullWidth>
              Ask the assistant again
            </ButtonLink>
            <ButtonLink to={paths.history} variant="secondary" fullWidth>
              Back to history
            </ButtonLink>
          </>
        ) : (
          <>
            <Link to={paths.emergency} className={styles.urgent}>
              <Icon name="alert" size={20} className={styles.noteIcon} />
              <span className={styles.noteText}>
                <span className={styles.noteTitle}>Feeling worse while you wait?</span>
                <span className={styles.noteBody}>Get urgent help now. It’s free.</span>
              </span>
            </Link>
            <ButtonLink to={paths.home} variant="secondary" fullWidth>
              Back to home
            </ButtonLink>
          </>
        )
      }
    >
      <div aria-live="polite" className={styles.stack}>
        <StatusBadge status={status} />
        <h2 className={styles.heading}>{headingFor(status, question)}</h2>
      </div>

      {ended ? (
        <p className={styles.lead}>
          You were not charged.
          {question.isFree && ' Your free answer is available again.'}
        </p>
      ) : (
        <Timeline question={question} status={status} />
      )}

      {pollFailed && !ended && (
        <div className={styles.errorBlock}>
          <Alert tone="info">We couldn’t check for updates just now. We’ll keep trying.</Alert>
          <Button variant="secondary" onClick={onCheckNow}>
            Check now
          </Button>
        </div>
      )}

      <section className={styles.softCard} aria-labelledby="w10-question">
        <h3 id="w10-question" className={styles.cardLabel}>
          Your question
        </h3>
        <p className={styles.bodyText}>{questionTitle(question)}</p>
      </section>

      {!ended && (
        <p className={styles.inlineNote}>
          <Icon name="lock" size={18} className={styles.noteIcon} />
          {question.isFree
            ? 'This answer is free. Nothing will be charged.'
            : `Nothing charged yet. ${formatNaira(question.price)} on delivery.`}
        </p>
      )}
    </FlowScreen>
  );
}

function StatusBadge({ status }: { status: WaitingProps['status'] }) {
  if (status === 'expired') return <Badge variant="neutral">Expired</Badge>;
  if (status === 'cancelled') return <Badge variant="neutral">Cancelled</Badge>;
  return <Badge variant="accent">In review</Badge>;
}

function headingFor(status: WaitingProps['status'], question: MyQuestion): string {
  switch (status) {
    case 'claimed':
      return 'A nurse or midwife is reviewing your question';
    case 'open':
      return question.chosenNurse
        ? `Waiting for ${firstName(question.chosenNurse.displayName)} to pick it up`
        : 'Waiting for a nurse or midwife';
    case 'expired':
      return 'No nurse or midwife was free in time';
    case 'cancelled':
      return 'This question was cancelled';
  }
}

function firstName(displayName: string) {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

/** Figma "Timeline": sent, reviewing, answer delivered. */
function Timeline({ question, status }: { question: MyQuestion; status: 'open' | 'claimed' }) {
  const claimed = status === 'claimed';
  const chosenUntil = new Date(
    Date.parse(question.createdAt) + CHOSEN_NURSE_WINDOW_MINUTES * 60_000,
  ).toISOString();

  return (
    <ol className={styles.timeline} aria-label="Progress of your question">
      <TimelineStep state="done" title="Sent anonymously">
        <time dateTime={question.createdAt} title={formatFullDate(question.createdAt)}>
          {formatTime(question.createdAt)}
        </time>
      </TimelineStep>

      <TimelineStep
        state="current"
        title={claimed ? 'Being reviewed' : 'Waiting for a nurse or midwife'}
      >
        {claimed ? (
          'A verified nurse or midwife has picked up your question.'
        ) : question.chosenNurse ? (
          <>
            Sent to {question.chosenNurse.displayName} first. From{' '}
            <time dateTime={chosenUntil}>{formatTime(chosenUntil)}</time>, any available nurse or
            midwife can answer.
          </>
        ) : (
          <>
            Any available verified nurse or midwife can pick it up. If no one does by{' '}
            <time dateTime={question.claimsCloseAt}>{formatTime(question.claimsCloseAt)}</time>, you
            pay nothing.
          </>
        )}
      </TimelineStep>

      <TimelineStep state="todo" title="Answer delivered" last>
        You can close the app. Your answer will be waiting in History.
      </TimelineStep>
    </ol>
  );
}

function TimelineStep({
  state,
  title,
  last = false,
  children,
}: {
  state: 'done' | 'current' | 'todo';
  title: string;
  last?: boolean;
  children: ReactNode;
}) {
  const stateLabel = { done: 'Done', current: 'In progress', todo: 'Next' }[state];
  return (
    <li className={styles.step} aria-current={state === 'current' ? 'step' : undefined}>
      <span className={styles.rail} aria-hidden>
        <span
          className={cx(
            styles.dot,
            state === 'done' && styles.dotDone,
            state === 'current' && styles.dotCurrent,
            state === 'todo' && styles.dotTodo,
          )}
        >
          {state === 'done' && <Icon name="check" size={16} />}
        </span>
        {!last && <span className={cx(styles.railLine, state === 'done' && styles.railLineDone)} />}
      </span>
      <span className={styles.stepText}>
        <span className={state === 'todo' ? styles.stepTitleTodo : styles.stepTitle}>
          <span className="visually-hidden">{stateLabel}: </span>
          {title}
        </span>
        <span className={styles.small}>{children}</span>
      </span>
    </li>
  );
}
