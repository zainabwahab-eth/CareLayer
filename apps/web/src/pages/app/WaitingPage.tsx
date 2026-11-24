import type { MyQuestion } from '@carelayer/shared';
import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { hasErrorCode } from '../../api/errors';
import { useApiQuery } from '../../api/useApiQuery';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { Alert } from '../../components/Alert/Alert';
import { Badge } from '../../components/Badge/Badge';
import { Button, ButtonLink } from '../../components/Button/Button';
import { Icon } from '../../components/Icon/Icon';
import { cx } from '../../components/cx';
import { consultationPath, paths } from '../../routes/paths';
import { formatTime } from '../../utils/dates';
import { formatNaira } from '../../utils/money';
import { shortNurseName } from '../../utils/nurses';
import styles from './ask/AskFlow.module.css';
import { FlowHeader } from './ask/FlowHeader';
import { flowErrorMessage } from './ask/flow-errors';
import { questionTitle, statusBadge } from './history/question-display';

/** How often W10 checks for the answer (GET /me/questions/:id). */
export const WAITING_POLL_MS = 10_000;

/**
 * W10 Waiting (Figma: W10 / D-W10). Checks GET /me/questions/:id every few seconds
 * and opens W11 as soon as the answer is in. Expired: no one was free in time, and
 * she pays nothing.
 */
export function WaitingPage() {
  const { consultationId = '' } = useParams();
  const question = useApiQuery((api) => api.questions.getMine(consultationId), [consultationId]);
  useSessionGuard(question.error);

  const status = question.data?.status;
  const reload = question.reload;
  const waiting = status === 'open' || status === 'claimed' || question.status === 'loading';
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(reload, WAITING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, reload]);

  if (status === 'answered') return <Navigate to={consultationPath(consultationId)} replace />;

  return (
    <div className={styles.page}>
      <FlowHeader title="Waiting for a nurse" backTo={paths.consultations} />

      {question.status === 'loading' && (
        <p className={styles.message} role="status">
          Loading your question…
        </p>
      )}

      {question.status === 'error' && (
        <div className={styles.errorBlock}>
          <Alert tone="error">
            {hasErrorCode(question.error, 'NOT_FOUND')
              ? 'We could not find this question.'
              : flowErrorMessage(question.error, 'We could not load your question.')}
          </Alert>
          <Button variant="secondary" onClick={question.reload}>
            Try again
          </Button>
        </div>
      )}

      {question.data && <WaitingDetails question={question.data} />}
    </div>
  );
}

function WaitingDetails({ question }: { question: MyQuestion }) {
  const badge = statusBadge(question);
  const nurse = question.chosenNurse ? shortNurseName(question.chosenNurse.displayName) : null;
  const ended = question.status === 'expired' || question.status === 'cancelled';

  const title =
    question.status === 'expired'
      ? 'No one was free in time'
      : question.status === 'cancelled'
        ? 'This question was cancelled'
        : question.status === 'claimed'
          ? `${nurse ?? 'A nurse'} is reviewing your question`
          : nurse
            ? `Waiting for ${nurse}`
            : 'Waiting for a verified nurse';

  return (
    <>
      <div className={styles.heading}>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <h2 className={styles.title} aria-live="polite">
          {title}
        </h2>
        {!ended && (
          <p className={styles.lead}>
            We will show the answer here as soon as it arrives. You can leave this page.
          </p>
        )}
      </div>

      {!ended && (
        <ol className={styles.timeline} aria-label="Progress">
          <Step state="done" label="Sent anonymously" detail={formatTime(question.createdAt)} />
          <Step
            state={question.status === 'claimed' ? 'current' : 'next'}
            label={question.status === 'claimed' ? 'Nurse reviewing' : 'Waiting for a nurse'}
          />
          <Step state="next" label="Answer delivered" />
        </ol>
      )}

      <section className={styles.card} aria-labelledby="waiting-question">
        <h3 id="waiting-question" className={styles.cardTitle}>
          Your question
        </h3>
        <p className={styles.body}>{questionTitle(question)}</p>
      </section>

      <p className={styles.warning}>
        <Icon name="wallet" size={18} className={styles.noteIcon} />
        <span>
          {ended
            ? 'You were not charged.'
            : question.isFree
              ? 'Nothing charged. This answer is free.'
              : `Nothing charged yet. ${formatNaira(question.price)} on delivery.`}
        </span>
      </p>

      {!ended && (
        <div className={styles.emergency}>
          <Icon name="alert" size={18} className={styles.noteIcon} />
          <div className={styles.noteBody}>
            <span>Feeling worse while you wait? Get urgent help now. It’s free.</span>
            <Link to={paths.emergency} className={styles.link}>
              Get urgent help
            </Link>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        {ended && <ButtonLink to={paths.ask}>Ask again</ButtonLink>}
        <ButtonLink to={paths.home} variant={ended ? 'secondary' : 'primary'}>
          Back to home
        </ButtonLink>
      </div>
    </>
  );
}

function Step({
  state,
  label,
  detail,
}: {
  state: 'done' | 'current' | 'next';
  label: string;
  detail?: string;
}) {
  return (
    <li
      className={cx(
        styles.step,
        state === 'done' && styles.stepDone,
        state === 'current' && styles.stepCurrent,
      )}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      <span className={styles.dot} aria-hidden>
        {state === 'done' && <Icon name="check" size={14} />}
      </span>
      <span className={styles.stepText}>
        <span>{label}</span>
        {detail && <span className={styles.small}>{detail}</span>}
      </span>
    </li>
  );
}
