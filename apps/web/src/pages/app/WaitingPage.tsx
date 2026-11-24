import { QUESTION_CLAIMS_CLOSE_MINUTES, type MyQuestion } from '@carelayer/shared';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { hasErrorCode } from '../../api/errors';
import { useApi } from '../../api/useApi';
import { useApiQuery } from '../../api/useApiQuery';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { NEW_CHAT_STATE } from '../../chat/ask-route-state';
import { Alert } from '../../components/Alert/Alert';
import { Badge } from '../../components/Badge/Badge';
import { Button, ButtonLink } from '../../components/Button/Button';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon/Icon';
import { Toggle } from '../../components/Toggle/Toggle';
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { consultationPath, paths } from '../../routes/paths';
import { categoryLabel } from '../../utils/categories';
import { formatTime } from '../../utils/dates';
import { formatNaira } from '../../utils/money';
import { nurseLine, shortNurseName } from '../../utils/nurses';
import styles from './WaitingPage.module.css';
import { FlowHeader } from './ask/FlowHeader';
import { flowErrorMessage } from './ask/flow-errors';
import { questionTitle, statusBadge } from './history/question-display';

/** How often W10 checks for the answer (GET /me/questions/:id). */
export const WAITING_POLL_MS = 10_000;

/**
 * W10 Waiting (Figma: "W10 Waiting", "D-W10 Waiting"). Checks GET /me/questions/:id
 * every few seconds and opens W11 as soon as the answer is in. Expired: no one was
 * free in time, and she pays nothing.
 */
export function WaitingPage() {
  const { consultationId = '' } = useParams();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
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

  const q = question.data;
  const headline = q ? headlineFor(q) : 'Waiting for a nurse';
  const badge = q ? statusBadge(q) : null;

  return (
    <div className={styles.page}>
      <FlowHeader
        title={isDesktop ? headline : 'Consultation'}
        subtitle={q ? categoryLabel(q.category) : undefined}
        desktopSubtitle={
          q
            ? `${categoryLabel(q.category)} consultation, started ${formatTime(q.createdAt)}`
            : undefined
        }
        backTo={paths.consultations}
        backLabel="Back to consultations"
        actions={badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
      />

      {question.status === 'loading' && (
        <p className={styles.muted} role="status">
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

      {q && <WaitingDetails question={q} headline={headline} desktop={isDesktop} />}
    </div>
  );
}

function headlineFor(question: MyQuestion) {
  const nurse = question.chosenNurse ? shortNurseName(question.chosenNurse.displayName) : null;
  if (question.status === 'expired') return 'No one was free in time';
  if (question.status === 'cancelled') return 'This question was cancelled';
  if (question.status === 'claimed') return `${nurse ?? 'A nurse'} is reviewing your question`;
  return nurse ? `Waiting for ${nurse}` : 'Waiting for a verified nurse';
}

function WaitingDetails({
  question,
  headline,
  desktop,
}: {
  question: MyQuestion;
  headline: string;
  desktop: boolean;
}) {
  const badge = statusBadge(question);
  const ended = question.status === 'expired' || question.status === 'cancelled';
  const claimed = question.status === 'claimed';
  const role = question.chosenNurse?.role === 'midwife' ? 'Midwife' : 'Nurse';
  const price = formatNaira(question.price);

  const timeline = !ended && (
    <ol className={styles.timeline} aria-label="Progress">
      <Step
        state="done"
        title="Sent anonymously"
        detail={`${formatTime(question.createdAt)}. Your question and the details you agreed to share only.`}
      />
      <Step
        state={claimed ? 'current' : 'next'}
        title={claimed ? `${role} reviewing` : 'Waiting for a nurse'}
        detail={
          claimed
            ? `${question.chosenNurse ? `${nurseLine(question.chosenNurse)} is answering. ` : ''}Answers usually take 5–10 minutes.`
            : `A verified nurse will pick it up soon. If no one does within ${QUESTION_CLAIMS_CLOSE_MINUTES} minutes, you pay nothing.`
        }
      />
      <Step
        state="next"
        title="Answer delivered"
        detail="We’ll notify you. You can close this page."
        last
      />
    </ol>
  );

  const yourQuestion = (
    <section className={styles.question} aria-labelledby="waiting-question">
      <h2 id="waiting-question" className={styles.label}>
        Your question
      </h2>
      <p className={styles.questionText}>{questionTitle(question)}</p>
    </section>
  );

  const charge = ended
    ? 'You were not charged.'
    : question.isFree
      ? 'This answer is free.'
      : `${price} is paid only when the answer reaches you.`;

  const emergency = !ended && (
    <Link to={paths.emergency} className={styles.emergency}>
      <span className={styles.emergencyTitle}>
        <Icon name="alert" size={20} />
        Feeling worse while you wait?
      </span>
      <span className={styles.emergencyText}>
        Get urgent help now. It’s free{desktop ? ' and nothing is shared' : ''}.
      </span>
    </Link>
  );

  const actions = (
    <>
      {ended && (
        <ButtonLink to={paths.ask} state={NEW_CHAT_STATE} fullWidth>
          Ask again
        </ButtonLink>
      )}
      <ButtonLink to={paths.home} variant="secondary" fullWidth>
        Back to home
      </ButtonLink>
    </>
  );

  if (desktop) {
    return (
      <div className={styles.grid}>
        <div className={styles.left}>
          {ended ? (
            <section className={styles.card}>
              <h2 className={styles.endedTitle}>{headline}</h2>
              <p className={styles.muted}>
                {question.status === 'expired'
                  ? `No verified nurse was free within ${QUESTION_CLAIMS_CLOSE_MINUTES} minutes.`
                  : 'It was withdrawn before a nurse answered.'}
              </p>
            </section>
          ) : (
            <section className={styles.card}>{timeline}</section>
          )}
          {yourQuestion}
        </div>
        <div className={styles.right}>
          <section className={styles.charged} aria-labelledby="waiting-charged">
            <h2 id="waiting-charged" className={styles.chargedTitle}>
              <Icon name="lock" size={20} />
              {ended ? 'Not charged' : 'Nothing charged yet'}
            </h2>
            <p className={styles.chargedText}>{charge}</p>
          </section>
          {!ended && <NotifyToggle />}
          {emergency}
          {actions}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.mobileHead}>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <h2 className={styles.mobileTitle} aria-live="polite">
          {headline}
        </h2>
      </div>
      {timeline && <section className={styles.card}>{timeline}</section>}
      {yourQuestion}
      <p className={styles.chargedLine}>
        <Icon name="lock" size={16} />
        <span>
          {ended
            ? 'You were not charged.'
            : question.isFree
              ? 'Nothing charged. This answer is free.'
              : `Nothing charged yet. ${price} on delivery.`}
        </span>
      </p>
      <div className={styles.mobileFooter}>
        {emergency}
        {actions}
      </div>
    </>
  );
}

/** "Notify me when answered" (GET/PATCH /me/notifications, by email). */
function NotifyToggle() {
  const api = useApi();
  const prefs = useApiQuery((client) => client.me.getNotifications());
  const [value, setValue] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const checked = value ?? prefs.data?.notifyWhenAnswered ?? false;

  const change = async (next: boolean) => {
    setValue(next);
    setFailed(false);
    try {
      const saved = await api.me.updateNotifications({ notifyWhenAnswered: next });
      setValue(saved.notifyWhenAnswered);
    } catch {
      setValue(!next);
      setFailed(true);
    }
  };

  return (
    <section className={styles.notify} aria-label="Notifications">
      <Icon name="bell" size={20} />
      <Toggle
        checked={checked}
        disabled={prefs.status !== 'success'}
        onCheckedChange={(next) => void change(next)}
        label="Notify me when answered"
        description={failed ? 'Not saved. Please try again.' : undefined}
        className={styles.notifyToggle}
      />
    </section>
  );
}

function Step({
  state,
  title,
  detail,
  last = false,
}: {
  state: 'done' | 'current' | 'next';
  title: string;
  detail: string;
  last?: boolean;
}) {
  return (
    <li
      className={cx(
        styles.step,
        state === 'done' && styles.stepDone,
        state === 'current' && styles.stepCurrent,
        state === 'next' && styles.stepNext,
      )}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      <span className={styles.rail} aria-hidden>
        <span className={styles.dot}>{state === 'done' && <Icon name="check" size={16} />}</span>
        {!last && <span className={styles.line} />}
      </span>
      <span className={styles.stepText}>
        <span className={styles.stepTitle}>{title}</span>
        <span className={styles.stepDetail}>{detail}</span>
      </span>
    </li>
  );
}
