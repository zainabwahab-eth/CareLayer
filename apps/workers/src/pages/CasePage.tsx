import { ANSWER_TEXT_MAX_LENGTH, type NurseQuestionView } from '@carelayer/shared';
import { isApiError } from '@web/api/errors';
import { isSessionError } from '@web/auth/auth-flow';
import { Alert } from '@web/components/Alert/Alert';
import { BackLink } from '@web/components/BackLink/BackLink';
import { Button, ButtonLink } from '@web/components/Button/Button';
import { Checkbox } from '@web/components/Checkbox/Checkbox';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import { Toggle } from '@web/components/Toggle/Toggle';
import { formatNaira } from '@web/utils/money';
import { useId, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useNurseApi } from '../api/api-context';
import { useAuth } from '../auth/useAuth';
import { casePath, caseSentPath, casesPath } from '../routes/paths';
import { CaseTags, EmptyState, LoadError, Skeleton } from '../workspace/components';
import { answerErrorMessage, claimErrorMessage, releaseErrorMessage } from '../workspace/errors';
import {
  ANSWER_SHARE_KOBO,
  ageRangeLabel,
  formatCountdown,
  msUntil,
  waitingLabel,
} from '../workspace/format';
import { useNow, useNurseQuery } from '../workspace/hooks';
import styles from '../workspace/workspace.module.css';

/*
 * N07 Respond (Figma: Nurse -mobile / N07), also the question's details before she claims.
 *   open     -> read it in full, "Claim and answer" (POST /nurse/questions/:id/claim)
 *   claimed  -> hers: answer within the 10-minute lock (POST .../answer), or Release
 *   answered / expired / someone else's claim -> read-only, with where to go next
 * The answer is kept in memory only, never in storage (it holds health details).
 */

export interface AnswerSentState {
  questionId: string;
  answeredAt: string;
  recommendSeeSomeoneToday: boolean;
}

export function CasePage() {
  const { id = '' } = useParams();
  const question = useNurseQuery((api) => api.cases.get(id), [id]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <BackLink to={casesPath()} label="Back to cases" />
      </div>
      {question.status === 'loading' && <Skeleton count={2} height="12rem" />}
      {question.status === 'error' &&
        (isApiError(question.error) && question.error.code === 'NOT_FOUND' ? (
          <EmptyState
            icon="alert"
            title="This question is no longer available"
            action={<ButtonLink to={casesPath()}>Back to cases</ButtonLink>}
          >
            Another health worker may have taken it, or it closed.
          </EmptyState>
        ) : (
          <LoadError
            error={question.error}
            fallback="We could not load this question."
            onRetry={question.reload}
          />
        ))}
      {question.status === 'success' && (
        <CaseBody question={question.data} onChanged={question.setData} reload={question.reload} />
      )}
    </div>
  );
}

function QuestionCard({ question }: { question: NurseQuestionView }) {
  return (
    <section className={styles.card} aria-label="Her question">
      <div className={styles.tags}>
        <CaseTags question={question} />
        {question.ageRange && (
          <span className={styles.tag}>{ageRangeLabel(question.ageRange)}</span>
        )}
        {question.pregnancyWeeks !== null && (
          <span className={styles.tag}>{question.pregnancyWeeks} weeks</span>
        )}
      </div>
      <p className={styles.body}>{question.cleanedText}</p>
      <span className={cx(styles.caption, styles.muted)}>Her words, with spelling fixed</span>
      {question.originalText && question.originalText !== question.cleanedText && (
        <details>
          <summary className={styles.link}>Her exact words</summary>
          <p className={styles.bodySmall} style={{ marginTop: 'var(--space-8)' }}>
            {question.originalText}
          </p>
        </details>
      )}
      {question.assistantNotes && (
        <div
          className={styles.stack}
          style={{
            padding: 'var(--space-12)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-surface-soft)',
          }}
        >
          <span className={cx(styles.label, styles.rowStart)} style={{ gap: 'var(--space-4)' }}>
            <Icon name="sparkle" size={16} /> Assistant notes
          </span>
          <p className={styles.bodySmall}>{question.assistantNotes}</p>
        </div>
      )}
    </section>
  );
}

function CaseBody({
  question,
  onChanged,
  reload,
}: {
  question: NurseQuestionView;
  onChanged: (q: NurseQuestionView) => void;
  reload: () => void;
}) {
  const now = useNow();
  const mine = question.status === 'claimed' && question.claimExpiresAt !== null;

  if (mine) return <RespondForm question={question} now={now} onReleased={reload} />;

  return (
    <>
      <QuestionCard question={question} />
      {question.status === 'open' && (
        <ClaimPanel question={question} now={now} onClaimed={onChanged} />
      )}
      {question.status === 'claimed' && (
        <Alert tone="info">Another health worker is answering this question.</Alert>
      )}
      {question.status === 'answered' && (
        <Alert tone="success">
          This question has been answered. You are paid when she opens the answer.
        </Alert>
      )}
      {question.status === 'expired' && (
        <Alert tone="info">This question closed before anyone answered. She pays nothing.</Alert>
      )}
      {question.status !== 'open' && (
        <ButtonLink to={casesPath()} variant="secondary">
          Back to cases
        </ButtonLink>
      )}
    </>
  );
}

function ClaimPanel({
  question,
  now,
  onClaimed,
}: {
  question: NurseQuestionView;
  now: number;
  onClaimed: (q: NurseQuestionView) => void;
}) {
  const api = useNurseApi();
  const navigate = useNavigate();
  const { sessionExpired } = useAuth();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<unknown>();
  const closesIn = msUntil(question.claimsCloseAt, now);
  const closed = closesIn <= 0;

  const claim = async () => {
    if (claiming) return; // No double claims from a double tap.
    setClaiming(true);
    setError(undefined);
    try {
      await api.cases.claim(question.id);
      onClaimed(await api.cases.get(question.id));
    } catch (e) {
      if (isSessionError(e)) sessionExpired();
      setError(e);
      setClaiming(false);
    }
  };

  const holding =
    isApiError(error) && error.code === 'ACTIVE_CLAIM_EXISTS'
      ? (error.details?.questionId as string | undefined)
      : undefined;

  return (
    <section className={styles.card} aria-label="Claim">
      <div className={styles.row}>
        <span className={styles.meta}>
          <Icon name="clock" size={16} />
          {closed
            ? 'Closed to new claims'
            : `${waitingLabel(question.createdAt, now)}. Claims close in ${formatCountdown(closesIn)}`}
        </span>
        <span className={styles.reward}>{formatNaira(ANSWER_SHARE_KOBO)}</span>
      </div>
      <p className={cx(styles.bodySmall, styles.muted)}>
        Claiming gives you 10 minutes to answer. Only you can answer it during that time. If you
        can’t finish, release it so another health worker can.
      </p>
      {error !== undefined && <Alert tone="error">{claimErrorMessage(error)}</Alert>}
      {holding && (
        <Button variant="secondary" onClick={() => void navigate(casePath(holding))}>
          Go to your open question
        </Button>
      )}
      <Button onClick={() => void claim()} disabled={claiming || closed} fullWidth>
        {claiming ? 'Claiming…' : 'Claim and answer'}
      </Button>
    </section>
  );
}

function RespondForm({
  question,
  now,
  onReleased,
}: {
  question: NurseQuestionView;
  now: number;
  onReleased: () => void;
}) {
  const api = useNurseApi();
  const navigate = useNavigate();
  const { sessionExpired } = useAuth();
  const answerId = useId();
  const [text, setText] = useState('');
  const [seekCare, setSeekCare] = useState(false);
  const [noDiagnosis, setNoDiagnosis] = useState(false);
  const [recommend, setRecommend] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string>();
  const [expired, setExpired] = useState(false);

  const left = msUntil(question.claimExpiresAt, now);
  const timeUp = expired || left <= 0;
  const trimmed = text.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || timeUp) return;
    setError(undefined);
    if (!trimmed) {
      setFieldError('Write your answer.');
      return;
    }
    if (trimmed.length > ANSWER_TEXT_MAX_LENGTH) {
      setFieldError(`Answers can be up to ${ANSWER_TEXT_MAX_LENGTH.toLocaleString()} characters.`);
      return;
    }
    if (!seekCare || !noDiagnosis) {
      setError('Check both points in the checklist before sending.');
      return;
    }
    setFieldError(undefined);
    setSending(true);
    try {
      const answer = await api.cases.answer(question.id, {
        text: trimmed,
        recommendSeeSomeoneToday: recommend,
      });
      const state: AnswerSentState = {
        questionId: answer.questionId,
        answeredAt: answer.answeredAt,
        recommendSeeSomeoneToday: answer.recommendSeeSomeoneToday,
      };
      void navigate(caseSentPath(question.id), { replace: true, state });
    } catch (e) {
      if (isSessionError(e)) sessionExpired();
      if (isApiError(e) && e.code === 'CLAIM_EXPIRED') setExpired(true);
      setError(answerErrorMessage(e));
      setSending(false);
    }
  };

  const release = async () => {
    setReleasing(true);
    setError(undefined);
    try {
      await api.cases.release(question.id);
      void navigate(casesPath(), { replace: true });
    } catch (e) {
      if (isSessionError(e)) sessionExpired();
      setError(releaseErrorMessage(e));
      setReleasing(false);
      setConfirmRelease(false);
      onReleased();
    }
  };

  return (
    <form className={styles.page} onSubmit={(e) => void submit(e)} noValidate>
      <div className={styles.row}>
        <h1 className={styles.titleSmall}>Answer case</h1>
        <span
          className={cx(styles.timer, (timeUp || left < 120_000) && styles.timerUrgent)}
          role="timer"
          aria-label={timeUp ? 'Time is up' : `${formatCountdown(left)} left to answer`}
        >
          <Icon name="clock" size={16} />
          {timeUp ? 'Time is up' : `${formatCountdown(left)} left`}
        </span>
      </div>

      <QuestionCard question={question} />

      <Alert tone="info">
        Give guidance, not a diagnosis or prescription. If anything she describes could be serious,
        tell her clearly to get care in person today, and turn on “Recommend she sees someone
        today”.
      </Alert>

      <div>
        <label htmlFor={answerId} className={styles.fieldLabel}>
          Your answer
        </label>
        <textarea
          id={answerId}
          className={cx(styles.textarea, fieldError && styles.textareaError)}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (fieldError) setFieldError(undefined);
          }}
          maxLength={ANSWER_TEXT_MAX_LENGTH}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={`${answerId}-count${fieldError ? ` ${answerId}-error` : ''}`}
          disabled={timeUp || sending}
          placeholder="Write in plain words she can act on."
        />
        <div className={styles.row}>
          {fieldError ? (
            <p id={`${answerId}-error`} className={styles.fieldError}>
              {fieldError}
            </p>
          ) : (
            <span />
          )}
          <span id={`${answerId}-count`} className={cx(styles.caption, styles.muted)}>
            {trimmed.length.toLocaleString()} / {ANSWER_TEXT_MAX_LENGTH.toLocaleString()}
          </span>
        </div>
      </div>

      <fieldset className={styles.stack} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className={styles.srOnly}>Before you send</legend>
        <Checkbox checked={seekCare} onChange={(e) => setSeekCare(e.target.checked)}>
          Explains when to seek care in person
        </Checkbox>
        <Checkbox checked={noDiagnosis} onChange={(e) => setNoDiagnosis(e.target.checked)}>
          No diagnosis or prescription
        </Checkbox>
      </fieldset>

      <Toggle
        checked={recommend}
        onCheckedChange={setRecommend}
        label="Recommend she sees someone today"
        description="She sees this clearly at the top of your answer."
      />

      {timeUp && (
        <Alert tone="error">
          Your 10 minutes ran out, so this answer can’t be sent. The question is open to others
          again. Copy your text if you want to keep it.
        </Alert>
      )}
      {error && !timeUp && <Alert tone="error">{error}</Alert>}

      {confirmRelease ? (
        <div className={styles.card}>
          <p className={styles.bodySmall}>
            Release this question? It goes back to the waiting list for another health worker.
          </p>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => setConfirmRelease(false)}>
              Keep answering
            </Button>
            <Button type="button" onClick={() => void release()} disabled={releasing}>
              {releasing ? 'Releasing…' : 'Yes, release'}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          {timeUp ? (
            <ButtonLink to={casesPath()} variant="secondary">
              Back to cases
            </ButtonLink>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setConfirmRelease(true)}>
              Release
            </Button>
          )}
          <Button type="submit" disabled={sending || timeUp}>
            {sending ? 'Sending…' : `Send answer, earn ${formatNaira(ANSWER_SHARE_KOBO)}`}
          </Button>
        </div>
      )}
    </form>
  );
}
