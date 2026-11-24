import {
  stellarExplorerUrl,
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
import { useAppShell } from '../../layouts/app-shell';
import { consultationWaitingPath, paths } from '../../routes/paths';
import { formatNaira } from '../../utils/money';
import { nurseRoleLabel } from '../../utils/nurses';
import styles from './ask/AskFlow.module.css';
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
 * W11 Nurse response (Figma: W11 / D-W11). Opening the answer collects it
 * (POST /me/questions/:id/collect): pay on delivery from her balance, or a free answer.
 * Collecting again is free, so the receipt shows on every visit. Above her limit she
 * approves first; short of money she tops up.
 */
export function NurseResponsePage() {
  const { consultationId = '' } = useParams();
  const question = useApiQuery((api) => api.questions.getMine(consultationId), [consultationId]);
  useSessionGuard(question.error);

  if (question.data && question.data.status !== 'answered') {
    return <Navigate to={consultationWaitingPath(consultationId)} replace />;
  }

  return (
    <div className={styles.page}>
      <FlowHeader title="Your nurse has replied" backTo={paths.history} />

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
      {question.data && <CollectedAnswer question={question.data} />}
    </div>
  );
}

function CollectedAnswer({ question }: { question: MyQuestion }) {
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

  return <AnswerView question={question} response={collect.response} />;
}

function minutesBetween(from: string, to: string) {
  return Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
}

function AnswerView({ question, response }: { question: MyQuestion; response: AnswerResponse }) {
  const { answer, payment } = response;
  const minutes = minutesBetween(question.createdAt, answer.answeredAt);

  return (
    <>
      <section className={styles.card} aria-labelledby="answer-nurse">
        <div className={styles.nurse}>
          <Avatar name={answer.nurse.displayName} size={48} decorative />
          <div className={styles.nurseText}>
            <h2 id="answer-nurse" className={styles.choiceName}>
              {answer.nurse.displayName}
            </h2>
            <span className={styles.small}>{nurseRoleLabel(answer.nurse.role)}</span>
          </div>
          <Badge variant="verified">Licence verified</Badge>
        </div>
        <p className={styles.small}>
          Answered in {minutes} {minutes === 1 ? 'minute' : 'minutes'}
        </p>
        <p className={styles.body}>{answer.text}</p>
      </section>

      {answer.recommendSeeSomeoneToday && (
        <div className={styles.emergency} role="note">
          <Icon name="alert" size={18} className={styles.noteIcon} />
          <div className={styles.noteBody}>
            <span>
              Your nurse recommends you see a health worker today. Go to a clinic today, and get
              urgent help if you feel worse.
            </span>
            <Link to={paths.emergency} className={styles.link}>
              Get urgent help
            </Link>
          </div>
        </div>
      )}

      <p className={styles.note}>
        <Icon name="wallet" size={18} className={styles.noteIcon} />
        <span>
          {payment.paidFromTreasury
            ? 'Free answer. You paid nothing.'
            : `${formatNaira(payment.amount)} paid on delivery.`}{' '}
          {payment.stellarTxHash && (
            <a
              href={stellarExplorerUrl('tx', payment.stellarTxHash)}
              target="_blank"
              rel="noreferrer"
              className={styles.link}
            >
              View receipt on Stellar
            </a>
          )}
        </span>
      </p>

      <Feedback questionId={question.id} initial={question.feedback?.helpful ?? null} />

      <div className={styles.actions}>
        <ButtonLink to={paths.ask} fullWidth>
          Ask another question
        </ButtonLink>
      </div>

      <p className={styles.small}>
        Health guidance, not a diagnosis. If you’re worried, visit a clinic.
      </p>
    </>
  );
}

function Feedback({ questionId, initial }: { questionId: Id; initial: boolean | null }) {
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
    <div className={styles.errorBlock}>
      <div className={styles.feedback} role="group" aria-label="Was this helpful?">
        <span className={styles.feedbackLabel}>Was this helpful?</span>
        <Chip selected={helpful === true} disabled={saving} onClick={() => void rate(true)}>
          Yes
        </Chip>
        <Chip selected={helpful === false} disabled={saving} onClick={() => void rate(false)}>
          Not really
        </Chip>
      </div>
      {helpful !== null && !failed && (
        <p className={styles.small} role="status">
          Thank you. Your rating helps other women choose.
        </p>
      )}
      {failed && <Alert tone="error">Your rating was not saved. Please try again.</Alert>}
    </div>
  );
}
