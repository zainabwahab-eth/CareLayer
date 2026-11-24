import {
  NURSE_REGULATOR,
  stellarExplorerUrl,
  type AnswerResponse,
  type AnswerUnavailableDetails,
  type MyQuestion,
} from '@carelayer/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { hasErrorCode, isApiError } from '../../api/errors';
import { useApi } from '../../api/useApi';
import { useApiQuery } from '../../api/useApiQuery';
import { isSessionError } from '../../auth/auth-flow';
import { useAuth } from '../../auth/useAuth';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { Alert } from '../../components/Alert/Alert';
import { Avatar } from '../../components/Avatar/Avatar';
import { Badge } from '../../components/Badge/Badge';
import { Button, ButtonLink } from '../../components/Button/Button';
import { Checkbox } from '../../components/Checkbox/Checkbox';
import { Chip } from '../../components/Chip/Chip';
import { Icon } from '../../components/Icon/Icon';
import { useAppShell } from '../../layouts/app-shell';
import { consultationWaitingPath, paths } from '../../routes/paths';
import { categoryLabel } from '../../utils/categories';
import { formatNaira } from '../../utils/money';
import { nurseRoleLabel } from '../../utils/nurses';
import { formatMinutes, questionTitle } from './history/question-display';
import { FlowScreen } from './send/FlowScreen';
import styles from './send/flow.module.css';
import { QuestionLoadError, QuestionLoading } from './send/QuestionLoadStates';

/*
 * W11 Nurse response (Figma "W11 Nurse response").
 *
 * Pay on delivery: the answer is collected with POST /me/questions/:id/collect,
 * where the API's own agent pays over x402 from her custodial wallet (or uses a
 * free answer). The app never pays or marks anything paid itself, and only shows
 * an answer the API returned. Collecting moves money, so it waits for her tap;
 * an answer she already opened is fetched again with the same call, which returns
 * the same answer and receipt and never charges twice (contract §8.3 step 3).
 */
export function NurseResponsePage() {
  const { consultationId = '' } = useParams();
  const question = useApiQuery((api) => api.questions.getMine(consultationId), [consultationId]);
  useSessionGuard(question.error);

  if (question.status === 'loading') return <QuestionLoading />;
  if (question.status === 'error') {
    return <QuestionLoadError error={question.error} onRetry={question.reload} />;
  }
  // Not answered yet, expired or cancelled: W10 shows those states.
  if (question.data.status !== 'answered') {
    return <Navigate to={consultationWaitingPath(consultationId)} replace />;
  }
  return <NurseResponse question={question.data} onStale={question.reload} />;
}

type Collect =
  | { status: 'ready' }
  | { status: 'collecting' }
  | { status: 'done'; result: AnswerResponse }
  /** Above her per-answer limit: she must approve this price. */
  | { status: 'approve'; priceKobo: number; limitKobo: number }
  | { status: 'insufficient'; priceKobo: number; balanceKobo: number | null }
  /** A payment was sent and is being confirmed; retried automatically. */
  | { status: 'pending'; retryInMs: number }
  | { status: 'error'; message: string };

const DEFAULT_PENDING_RETRY_MS = 10_000;

function NurseResponse({ question, onStale }: { question: MyQuestion; onStale: () => void }) {
  const api = useApi();
  const { sessionExpired } = useAuth();
  const { refreshWallet } = useAppShell();
  const alreadyCollected = question.answer !== null;
  const [collect, setCollect] = useState<Collect>(
    alreadyCollected ? { status: 'collecting' } : { status: 'ready' },
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (approvedAboveLimit = false) => {
      setCollect({ status: 'collecting' });
      try {
        const result = await api.questions.collectAnswer(
          question.id,
          approvedAboveLimit ? { approvedAboveLimit: true } : undefined,
        );
        if (!mounted.current) return;
        setCollect({ status: 'done', result });
        refreshWallet();
      } catch (error) {
        if (!mounted.current) return;
        if (isSessionError(error)) {
          sessionExpired();
          return;
        }
        setCollect(collectErrorState(error));
        if (
          hasErrorCode(error, 'QUESTION_NOT_ANSWERED') ||
          hasErrorCode(error, 'QUESTION_EXPIRED')
        ) {
          onStale(); // status changed under us: reload and let W10 show it
        }
      }
    },
    [api, question.id, refreshWallet, sessionExpired, onStale],
  );

  // An answer she already opened: fetch it again for the receipt. Never charges.
  const fetchedCollected = useRef(false);
  useEffect(() => {
    if (!alreadyCollected || fetchedCollected.current) return;
    fetchedCollected.current = true;
    void run();
  }, [alreadyCollected, run]);

  // A payment still being confirmed on Stellar: check again by itself.
  useEffect(() => {
    if (collect.status !== 'pending') return;
    const timer = setTimeout(() => void run(), collect.retryInMs);
    return () => clearTimeout(timer);
  }, [collect, run]);

  const result = collect.status === 'done' ? collect.result : null;
  // Already opened: show the answer the API gave before at once; the receipt follows.
  const answer = result?.answer ?? (alreadyCollected ? question.answer : null);
  const receiptError =
    alreadyCollected && collect.status !== 'done' && collect.status !== 'collecting';

  return (
    <FlowScreen
      title="Your answer"
      subtitle={categoryLabel(question.category)}
      backTo={paths.history}
      backLabel="Back to history"
      footer={
        <>
          <ButtonLink to={paths.history} fullWidth variant={answer ? 'primary' : 'secondary'}>
            Back to history
          </ButtonLink>
          {answer && (
            <p className={styles.caption}>
              Health guidance, not a diagnosis. If you’re worried, visit a clinic.
            </p>
          )}
        </>
      }
    >
      {answer ? (
        <AnswerView
          question={question}
          answer={answer}
          payment={result?.payment ?? null}
          receiptError={receiptError}
        />
      ) : (
        <CollectPanel question={question} collect={collect} onCollect={run} />
      )}
    </FlowScreen>
  );
}

function collectErrorState(error: unknown): Collect {
  if (!isApiError(error)) {
    return { status: 'error', message: 'We couldn’t open your answer. Please try again.' };
  }
  const details = error.details ?? {};
  switch (error.code) {
    case 'SPENDING_LIMIT_EXCEEDED':
      return {
        status: 'approve',
        priceKobo: Number(details.priceKobo) || 0,
        limitKobo: Number(details.spendingLimitKobo) || 0,
      };
    case 'INSUFFICIENT_BALANCE': {
      const price = details.price as { kobo?: number } | undefined;
      const balance = details.balance as { kobo?: number } | undefined;
      return {
        status: 'insufficient',
        priceKobo: Number(price?.kobo) || 0,
        balanceKobo: typeof balance?.kobo === 'number' ? balance.kobo : null,
      };
    }
    case 'SERVICE_UNAVAILABLE': {
      const unavailable = details as Partial<AnswerUnavailableDetails>;
      if (unavailable.paymentPending) {
        const seconds = Number(unavailable.retryAfterSeconds);
        return {
          status: 'pending',
          retryInMs:
            Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_PENDING_RETRY_MS,
        };
      }
      return {
        status: 'error',
        message: 'Payments are busy right now. Nothing was charged. Please try again in a moment.',
      };
    }
    case 'CONFLICT':
      return {
        status: 'error',
        message: 'A payment for this answer is already in progress. Check again in a moment.',
      };
    case 'QUESTION_NOT_ANSWERED':
    case 'QUESTION_EXPIRED':
      return { status: 'error', message: 'This question has changed. Loading it again…' };
    default:
      if (error.status === 0) {
        return {
          status: 'error',
          message:
            'We couldn’t confirm your answer. Try again: you are never charged twice for one answer.',
        };
      }
      return { status: 'error', message: 'We couldn’t open your answer. Please try again.' };
  }
}

/** Before the answer is opened: what it costs, then her explicit tap. */
function CollectPanel({
  question,
  collect,
  onCollect,
}: {
  question: MyQuestion;
  collect: Collect;
  onCollect: (approvedAboveLimit?: boolean) => Promise<void>;
}) {
  const [approved, setApproved] = useState(false);
  const busy = collect.status === 'collecting';
  const price = formatNaira(question.price);

  return (
    <>
      <span>
        <Badge variant="primary">Answered</Badge>
      </span>
      <h2 className={styles.heading}>Your answer is ready</h2>

      <section className={styles.softCard} aria-labelledby="w11-question">
        <h3 id="w11-question" className={styles.cardLabel}>
          Your question
        </h3>
        <p className={styles.bodyText}>{questionTitle(question)}</p>
      </section>

      <div className={styles.accentNote}>
        <Icon name="receipt" size={20} className={styles.noteIcon} />
        <div className={styles.noteText}>
          <p className={styles.noteTitle}>
            {question.isFree ? 'This answer is free' : `Opening it pays ${price}`}
          </p>
          <p className={styles.noteBody}>
            {question.isFree
              ? `It uses one of your free answers. If you have none left by now, ${price} is paid from your CareLayer balance instead.`
              : `Paid from your CareLayer balance in USDC on Stellar, through x402. You get a receipt.`}
          </p>
        </div>
      </div>

      {collect.status === 'approve' && (
        <Checkbox checked={approved} onChange={(event) => setApproved(event.target.checked)}>
          I approve paying {formatNaira(collect.priceKobo)}, which is above my limit of{' '}
          {formatNaira(collect.limitKobo)} per answer.
        </Checkbox>
      )}

      {collect.status === 'insufficient' && (
        <div className={styles.errorBlock}>
          <Alert tone="error">
            Not enough in your wallet for this answer (
            {formatNaira(collect.priceKobo || question.price.kobo)}
            {collect.balanceKobo !== null &&
              `; your balance is ${formatNaira(collect.balanceKobo)}`}
            ). Top up, then come back to open it. Nothing was charged.
          </Alert>
          <ButtonLink to={paths.wallet} variant="secondary">
            Top up
          </ButtonLink>
        </div>
      )}

      {collect.status === 'pending' && (
        <Alert tone="info">
          Your payment is being confirmed on Stellar. You won’t be asked to pay again. We’ll check
          again in a few seconds.
        </Alert>
      )}

      {collect.status === 'error' && <Alert tone="error">{collect.message}</Alert>}

      {collect.status === 'approve' ? (
        <Button fullWidth disabled={!approved || busy} onClick={() => void onCollect(true)}>
          Approve and open my answer
        </Button>
      ) : (
        <Button
          fullWidth
          disabled={busy || collect.status === 'pending'}
          aria-busy={busy}
          onClick={() => void onCollect(false)}
        >
          {busy
            ? 'Opening…'
            : collect.status === 'pending' ||
                collect.status === 'error' ||
                collect.status === 'insufficient'
              ? 'Try again'
              : question.isFree
                ? 'Open my answer'
                : `Pay ${price} and open`}
        </Button>
      )}
    </>
  );
}

function AnswerView({
  question,
  answer,
  payment,
  receiptError,
}: {
  question: MyQuestion;
  answer: NonNullable<MyQuestion['answer']>;
  payment: AnswerResponse['payment'] | null;
  receiptError: boolean;
}) {
  const minutes = (Date.parse(answer.answeredAt) - Date.parse(question.createdAt)) / 60_000;

  return (
    <>
      <section className={styles.nurseCard} aria-label="Answered by">
        <Avatar name={answer.nurse.displayName} decorative />
        <div className={styles.optionText}>
          <p className={styles.nurseName}>{answer.nurse.displayName}</p>
          <p className={styles.small}>{nurseRoleLabel(answer.nurse.role)}</p>
          <span>
            <Badge variant="verified">Licence verified, {NURSE_REGULATOR}</Badge>
          </span>
        </div>
      </section>

      {Number.isFinite(minutes) && minutes > 0 && (
        <span>
          <Badge variant="primary">Answered in {formatMinutes(minutes)}</Badge>
        </span>
      )}

      <h2 className="visually-hidden">The answer</h2>
      <p className={styles.answerText}>{answer.text}</p>

      {answer.recommendSeeSomeoneToday && (
        <div className={styles.accentNote}>
          <Icon name="alert" size={18} className={styles.noteIcon} />
          <div className={styles.noteText}>
            <p className={styles.noteTitle}>Your nurse recommends you see someone today</p>
            <p className={styles.noteBody}>
              Visit a clinic or health centre today. If it feels urgent,{' '}
              <Link to={paths.emergency} className={styles.link}>
                get urgent help now
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      <Receipt question={question} payment={payment} receiptError={receiptError} />

      <Feedback questionId={question.id} initial={question.feedback?.helpful ?? null} />
    </>
  );
}

function Receipt({
  question,
  payment,
  receiptError,
}: {
  question: MyQuestion;
  payment: AnswerResponse['payment'] | null;
  receiptError: boolean;
}) {
  if (!payment) {
    if (!receiptError) return null;
    return (
      <p className={styles.small}>
        The receipt didn’t load. Paid answers are listed in your{' '}
        <Link to={paths.wallet} className={styles.link}>
          wallet activity
        </Link>
        .
      </p>
    );
  }
  if (payment.paidFromTreasury) {
    return (
      <div className={styles.receipt}>
        <Icon name="receipt" size={20} className={styles.receiptIcon} />
        <span className={styles.noteText}>
          <span className={styles.noteTitle}>Free answer</span>
          <span className={styles.small}>Nothing was charged. CareLayer paid the nurse.</span>
        </span>
      </div>
    );
  }
  const title = `${formatNaira(payment.amount.kobo ? payment.amount : question.price)} paid on delivery`;
  if (!payment.stellarTxHash) {
    return (
      <div className={styles.receipt}>
        <Icon name="receipt" size={20} className={styles.receiptIcon} />
        <span className={styles.noteTitle}>{title}</span>
      </div>
    );
  }
  return (
    <a
      className={styles.receipt}
      href={stellarExplorerUrl('tx', payment.stellarTxHash)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon name="receipt" size={20} className={styles.receiptIcon} />
      <span className={styles.noteText}>
        <span className={styles.noteTitle}>{title}</span>
        <span className={styles.receiptLink}>
          View receipt on Stellar<span className="visually-hidden"> (opens in a new tab)</span>
        </span>
      </span>
      <Icon name="chevron" size={18} className={styles.receiptIcon} />
    </a>
  );
}

type FeedbackState = 'idle' | 'saving' | 'saved' | 'error';

function Feedback({ questionId, initial }: { questionId: string; initial: boolean | null }) {
  const api = useApi();
  const [helpful, setHelpful] = useState<boolean | null>(initial);
  const [state, setState] = useState<FeedbackState>('idle');

  const submit = async (value: boolean) => {
    const previous = helpful;
    setHelpful(value);
    setState('saving');
    try {
      await api.questions.submitFeedback(questionId, { helpful: value });
      setState('saved');
    } catch {
      setHelpful(previous);
      setState('error');
    }
  };

  return (
    <div className={styles.stack}>
      <fieldset className={styles.feedback} disabled={state === 'saving'}>
        <legend className={styles.feedbackLegend}>Was this helpful?</legend>
        <Chip selected={helpful === true} onClick={() => void submit(true)}>
          Yes
        </Chip>
        <Chip selected={helpful === false} onClick={() => void submit(false)}>
          Not really
        </Chip>
      </fieldset>
      <p className={styles.small} role="status">
        {state === 'saved' ? 'Thank you. Your feedback helps other women choose who answers.' : ''}
      </p>
      {state === 'error' && (
        <Alert tone="error">Your feedback wasn’t saved. Please try again.</Alert>
      )}
    </div>
  );
}
