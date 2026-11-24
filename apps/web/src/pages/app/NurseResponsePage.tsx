import { NEW_CHAT_STATE } from '../../chat/ask-route-state';
import {
  stellarExplorerUrl,
  type Answer,
  type AnswerResponse,
  type CollectAnswerBody,
  type Id,
  type MyQuestion,
} from '@carelayer/shared';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { hasErrorCode } from '../../api/errors';
import type { CareLayerApi } from '../../api/types';
import { useApi } from '../../api/useApi';
import { useApiQuery } from '../../api/useApiQuery';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { Alert } from '../../components/Alert/Alert';
import { Avatar } from '../../components/Avatar/Avatar';
import { Badge } from '../../components/Badge/Badge';
import { Button, ButtonLink } from '../../components/Button/Button';
import { Chip } from '../../components/Chip/Chip';
import { Icon } from '../../components/Icon/Icon';
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { useAppShell } from '../../layouts/app-shell';
import { consultationWaitingPath, paths } from '../../routes/paths';
import { formatNaira } from '../../utils/money';
import { categoryLabel } from '../../utils/categories';
import { formatTime } from '../../utils/dates';
import { nurseRoleLabel } from '../../utils/nurses';
import styles from './NurseResponsePage.module.css';
import { FlowHeader } from './ask/FlowHeader';
import { flowErrorMessage } from './ask/flow-errors';

/**
 * One collect per question at a time. Opening the answer pays for it, so a re-render or a
 * second mount (React StrictMode) must join the request in flight, never start another.
 */
const collecting = new Map<Id, Promise<AnswerResponse>>();

function collectOnce(api: CareLayerApi, id: Id, body: CollectAnswerBody) {
  let pending = collecting.get(id);
  if (!pending) {
    pending = api.questions.collectAnswer(id, body).finally(() => collecting.delete(id));
    collecting.set(id, pending);
  }
  return pending;
}

type Collect =
  | { status: 'loading' }
  | { status: 'done'; response: AnswerResponse }
  | { status: 'error'; error: unknown };

/**
 * W11 Nurse response (Figma: "W11 Nurse response", "D-W11 Nurse response"). Opening the answer collects it
 * (POST /me/questions/:id/collect): pay on delivery from her balance, or a free answer.
 * Collecting again is free, so the receipt shows on every visit. Above her limit she
 * approves first; short of money she tops up.
 */
export function NurseResponsePage() {
  const { consultationId = '' } = useParams();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const question = useApiQuery((api) => api.questions.getMine(consultationId), [consultationId]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  useSessionGuard(question.error);

  if (question.data && question.data.status !== 'answered') {
    return <Navigate to={consultationWaitingPath(consultationId)} replace />;
  }

  const q = question.data;
  const shown = answer ?? q?.answer ?? null;
  const minutes = q && shown ? minutesBetween(q.createdAt, shown.answeredAt) : null;
  const answeredIn =
    minutes === null ? null : `Answered in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;

  return (
    <div className={styles.page}>
      <FlowHeader
        title="Your answer"
        subtitle={q ? categoryLabel(q.category) : undefined}
        desktopSubtitle={
          q
            ? `${categoryLabel(q.category)} consultation${shown ? `, answered at ${formatTime(shown.answeredAt)}` : ''}`
            : undefined
        }
        backTo={paths.consultations}
        backLabel="Back to consultations"
        actions={answeredIn && <Badge variant="primary">{answeredIn}</Badge>}
      />

      {question.status === 'loading' && (
        <p className={styles.message} role="status">
          Loading your answer…
        </p>
      )}
      {question.status === 'error' && (
        <div className={styles.errorBlock}>
          <Alert tone="error">
            {hasErrorCode(question.error, 'NOT_FOUND')
              ? 'We could not find this question.'
              : flowErrorMessage(question.error, 'We could not load your answer.')}
          </Alert>
          <Button variant="secondary" onClick={question.reload}>
            Try again
          </Button>
        </div>
      )}
      {q && (
        <CollectedAnswer
          question={q}
          onCollected={setAnswer}
          answeredIn={isDesktop ? null : answeredIn}
          desktop={isDesktop}
        />
      )}
    </div>
  );
}

function CollectedAnswer({
  question,
  onCollected,
  answeredIn,
  desktop,
}: {
  question: MyQuestion;
  onCollected: (answer: Answer) => void;
  /** Mobile shows "Answered in N minutes" under the nurse; desktop has it in the header. */
  answeredIn: string | null;
  desktop: boolean;
}) {
  const api = useApi();
  const { refreshWallet } = useAppShell();
  const [approved, setApproved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [collect, setCollect] = useState<Collect>({ status: 'loading' });
  useSessionGuard(collect.status === 'error' ? collect.error : null);

  const tryAgain = (approve = approved) => {
    setCollect({ status: 'loading' });
    setApproved(approve);
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    let cancelled = false;
    collectOnce(api, question.id, approved ? { approvedAboveLimit: true } : {}).then(
      (response) => {
        if (cancelled) return;
        setCollect({ status: 'done', response });
        onCollected(response.answer);
        // Money moved (or a free answer was used): update the sidebar balance.
        if (!question.answer) refreshWallet();
      },
      (error: unknown) => {
        if (!cancelled) setCollect({ status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
    // Re-run only for a retry or once she approves paying above her limit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, question.id, approved, attempt]);

  if (collect.status === 'loading') {
    return (
      <p className={styles.message} role="status">
        Opening your answer…
      </p>
    );
  }

  if (collect.status === 'error') {
    const { error } = collect;
    if (hasErrorCode(error, 'SPENDING_LIMIT_EXCEEDED')) {
      const limit = error.details?.spendingLimitKobo;
      return (
        <div className={styles.errorBlock}>
          <Alert tone="info">
            Your answer is ready. It costs {formatNaira(question.price)}, more than your limit
            {typeof limit === 'number' ? ` of ${formatNaira(limit)}` : ''} per answer.
          </Alert>
          <Button onClick={() => tryAgain(true)}>
            Pay {formatNaira(question.price)} and open it
          </Button>
          <ButtonLink to={paths.wallet} variant="ghost">
            Change my limit
          </ButtonLink>
        </div>
      );
    }
    if (hasErrorCode(error, 'INSUFFICIENT_BALANCE')) {
      return (
        <div className={styles.errorBlock}>
          <Alert tone="info">
            Your answer is ready. Top up at least {formatNaira(question.price)} to open it.
          </Alert>
          <ButtonLink to={paths.wallet}>Top up</ButtonLink>
          <Button variant="secondary" onClick={() => tryAgain()}>
            I’ve topped up
          </Button>
        </div>
      );
    }
    return (
      <div className={styles.errorBlock}>
        <Alert tone="error">
          {flowErrorMessage(error, 'We could not open your answer. You were not charged.')}
        </Alert>
        <Button variant="secondary" onClick={() => tryAgain()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <AnswerView
      question={question}
      response={collect.response}
      answeredIn={answeredIn}
      desktop={desktop}
    />
  );
}

function minutesBetween(from: string, to: string) {
  return Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
}

function AnswerView({
  question,
  response,
  answeredIn,
  desktop,
}: {
  question: MyQuestion;
  response: AnswerResponse;
  answeredIn: string | null;
  desktop: boolean;
}) {
  const { answer, payment } = response;
  const nurse = (
    <section className={styles.nurseCard} aria-labelledby="answer-nurse">
      <div className={styles.nurseHead}>
        <Avatar name={answer.nurse.displayName} size={44} decorative />
        <div className={styles.nurseText}>
          <h2 id="answer-nurse" className={styles.nurseName}>
            {answer.nurse.displayName}
          </h2>
          <span className={styles.muted}>{nurseRoleLabel(answer.nurse.role)}</span>
          {!desktop && <Badge variant="verified">Licence verified, NMCN</Badge>}
        </div>
      </div>
      {desktop && <Badge variant="verified">Licence verified, NMCN</Badge>}
    </section>
  );

  const clinic = answer.recommendSeeSomeoneToday && (
    <div className={styles.clinic} role="note">
      <p className={styles.clinicTitle}>
        <Icon name="alert" size={18} />
        Go to a clinic today
      </p>
      <p className={styles.clinicText}>
        Your nurse recommends you see a health worker in person today. If you feel worse, get urgent
        help now.
      </p>
      <Link to={paths.emergency} className={styles.link}>
        Get urgent help
      </Link>
    </div>
  );

  const receiptText = (
    <span className={styles.receiptText}>
      <span className={styles.receiptTitle}>
        {payment.paidFromTreasury
          ? 'Free answer, nothing paid'
          : `${formatNaira(payment.amount)} paid on delivery`}
      </span>
      {payment.stellarTxHash && <span className={styles.receiptLink}>View receipt on Stellar</span>}
    </span>
  );
  const receipt = payment.stellarTxHash ? (
    <a
      href={stellarExplorerUrl('tx', payment.stellarTxHash)}
      target="_blank"
      rel="noreferrer"
      className={styles.receipt}
    >
      <Icon name="receipt" size={22} />
      {receiptText}
      <Icon name="chevron" size={18} className={styles.chevron} />
    </a>
  ) : (
    <div className={styles.receipt}>
      <Icon name="receipt" size={22} />
      {receiptText}
    </div>
  );

  const disclaimer = (
    <p className={styles.caption}>
      Health guidance, not a diagnosis. If you’re worried, visit a clinic.
    </p>
  );
  const askAgain = (
    <ButtonLink to={paths.ask} state={NEW_CHAT_STATE} fullWidth>
      Ask another question
    </ButtonLink>
  );

  if (desktop) {
    return (
      <div className={styles.grid}>
        <div className={styles.reading}>
          <section className={styles.asked} aria-labelledby="answer-asked">
            <h2 id="answer-asked" className={styles.label}>
              You asked
            </h2>
            <p className={styles.bodyM}>{question.cleanedText}</p>
          </section>
          <section className={styles.answerCard} aria-label="The answer">
            <p className={styles.answerText}>{answer.text}</p>
            {clinic}
            {disclaimer}
          </section>
        </div>
        <div className={styles.side}>
          {nurse}
          {receipt}
          <section className={styles.feedbackCard} aria-label="Feedback">
            <Feedback questionId={question.id} initial={question.feedback?.helpful ?? null} />
          </section>
          {askAgain}
        </div>
      </div>
    );
  }

  return (
    <>
      {nurse}
      {answeredIn && (
        <span className={styles.answeredIn}>
          <Badge variant="primary">{answeredIn}</Badge>
        </span>
      )}
      <p className={styles.answerText}>{answer.text}</p>
      {clinic}
      {receipt}
      <Feedback questionId={question.id} initial={question.feedback?.helpful ?? null} inline />
      <div className={styles.mobileFooter}>
        {askAgain}
        {disclaimer}
      </div>
    </>
  );
}

function Feedback({
  questionId,
  initial,
  inline = false,
}: {
  questionId: Id;
  initial: boolean | null;
  inline?: boolean;
}) {
  const api = useApi();
  const [helpful, setHelpful] = useState<boolean | null>(initial);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const rate = async (value: boolean) => {
    if (saving || value === helpful) return;
    setSaving(true);
    setFailed(false);
    try {
      const saved = await api.questions.submitFeedback(questionId, { helpful: value });
      setHelpful(saved.helpful);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.feedbackBlock}>
      <div
        className={inline ? styles.feedbackInline : styles.feedback}
        role="group"
        aria-label="Was this helpful?"
      >
        <span className={inline ? styles.muted : styles.feedbackLabel}>Was this helpful?</span>
        <span className={styles.chips}>
          <Chip selected={helpful === true} disabled={saving} onClick={() => void rate(true)}>
            Yes
          </Chip>
          <Chip selected={helpful === false} disabled={saving} onClick={() => void rate(false)}>
            Not really
          </Chip>
        </span>
      </div>
      {helpful !== null && !failed && (
        <p className={styles.caption} role="status">
          Thank you. Your rating helps other women choose.
        </p>
      )}
      {failed && <Alert tone="error">Your rating was not saved. Please try again.</Alert>}
    </div>
  );
}
