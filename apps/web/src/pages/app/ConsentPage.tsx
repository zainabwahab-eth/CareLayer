import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useApi } from '../../api/useApi';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { isDraftExpired } from '../../chat/ask-request';
import type { EmergencyLocationState } from '../../chat/emergency-state';
import { useChat } from '../../chat/useChat';
import { Alert } from '../../components/Alert/Alert';
import { Badge } from '../../components/Badge/Badge';
import { Button } from '../../components/Button/Button';
import { Checkbox } from '../../components/Checkbox/Checkbox';
import { Icon } from '../../components/Icon/Icon';
import { paths } from '../../routes/paths';
import { categoryLabel } from '../../utils/categories';
import { ageRangeLabel, pregnancyLabel } from '../../utils/question-details';
import styles from './ask/AskFlow.module.css';
import { FlowHeader } from './ask/FlowHeader';
import { flowErrorMessage } from './ask/flow-errors';

/**
 * W07 Consent (Figma: W07 / D-W07). Exactly what a nurse will receive, from
 * POST /chat/draft, and nothing leaves without her tick. The draft re-runs the
 * red-flag check on the whole question: an emergency goes to W13, never a nurse.
 */
export function ConsentPage() {
  const chat = useChat();
  const api = useApi();
  const navigate = useNavigate();
  const { canAskNurse, request, setRequest, thread } = chat;
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [agreed, setAgreed] = useState(request?.consented ?? false);
  useSessionGuard(error);

  const needsDraft = canAskNurse && (!request || isDraftExpired(request));

  useEffect(() => {
    if (!needsDraft) return;
    let cancelled = false;
    api.chat.draft({ messages: thread() }).then(
      (response) => {
        if (cancelled) return;
        if (response.kind === 'emergency') {
          const state: EmergencyLocationState = { emergency: response };
          navigate(paths.emergency, { state, replace: true });
          return;
        }
        setRequest((current) => ({
          draft: response.draft,
          draftToken: response.draftToken,
          draftExpiresAt: response.draftExpiresAt,
          offer: response.offer,
          consented: false,
          // Keep her W08 choices if she came back for a fresh draft.
          nurseSelection: current?.nurseSelection ?? 'first_available',
          chosenNurse: current?.chosenNurse ?? null,
          femaleOnly: current?.femaleOnly ?? false,
        }));
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, needsDraft, attempt, thread, setRequest, navigate]);

  // Nothing to consent to without her question (e.g. opened directly, or after a reload:
  // the chat lives in memory only). Send her back to the chat to ask it first.
  if (!chat.canAskNurse) return <Navigate to={paths.ask} replace />;
  return <Consent />;
}

type DraftLoad = { status: 'loading' } | { status: 'error'; message: string };

function Consent() {
  const api = useApi();
  const chat = useChat();
  const flow = useSendFlow();
  const { sessionExpired } = useAuth();
  const navigate = useNavigate();

  const draft = draftFor(flow, chat.turns);
  const [load, setLoad] = useState<DraftLoad>({ status: 'loading' });
  const [agreed, setAgreed] = useState(flow.consented && draft !== null);
  const [showConsentError, setShowConsentError] = useState(false);
  /** The thread a draft was last requested for, so one thread gets one request. */
  const requestedFor = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { turns, dismissOffer } = chat;
  const { setDraft } = flow;
  const requestDraft = useCallback(async () => {
    const threadKey = threadKeyOf(turns);
    requestedFor.current = threadKey;
    setLoad({ status: 'loading' });
    try {
      const response = await api.chat.draft({ messages: turns.slice(-CHAT_LIMITS.maxTurns) });
      if (!mounted.current) return;
      if (response.kind === 'emergency') {
        // Emergencies are free and never queued: no consent, no nurse, no payment.
        dismissOffer();
        const state: EmergencyLocationState = { emergency: response };
        navigate(paths.emergency, { state, replace: true });
        return;
      }
      setDraft(threadKey, response);
    } catch (error) {
      if (!mounted.current) return;
      if (isSessionError(error)) sessionExpired();
      requestedFor.current = null;
      setLoad({ status: 'error', message: draftErrorMessage(error) });
    }
  }, [api, turns, dismissOffer, setDraft, navigate, sessionExpired]);

  useEffect(() => {
    if (draft || requestedFor.current === threadKeyOf(turns)) return;
    void requestDraft();
  }, [draft, turns, requestDraft]);

  const onContinue = () => {
    if (!agreed) {
      setShowConsentError(true);
      return;
    }
    flow.giveConsent();
    navigate(paths.askChoose);
  };

  const draft = needsDraft ? null : request?.draft;

  const handleContinue = () => {
    if (!agreed) return;
    setRequest((current) => (current ? { ...current, consented: true } : current));
    navigate(paths.askChoose);
  };

  return (
    <div className={styles.page}>
      <FlowHeader title="Send to a nurse" subtitle="Step 1 of 3" backTo={paths.ask} />

      {!draft && !error && (
        <p className={styles.message} role="status">
          Preparing your question…
        </p>
      )}

      {!draft && Boolean(error) && (
        <div className={styles.errorBlock}>
          <Alert tone="error">
            {flowErrorMessage(error, 'We could not prepare your question. Please try again.')}
          </Alert>
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {draft && (
        <>
          <div className={styles.heading}>
            <h2 className={styles.title}>Here’s exactly what the nurse will see</h2>
            <p className={styles.lead}>Check it before anything is shared.</p>
          </div>

          <section className={styles.card} aria-labelledby="consent-question">
            <div className={styles.cardHeader}>
              <h3 id="consent-question" className={styles.cardTitle}>
                Your question
              </h3>
              <Link to={paths.ask} className={styles.link}>
                Edit
              </Link>
            </div>
            <p className={styles.body}>{draft.cleanedText}</p>
            <p className={styles.small}>Spelling tidied. Nothing removed or shortened.</p>
          </section>

          {draft.assistantNotes && (
            <section className={styles.card} aria-labelledby="consent-notes">
              <h3 id="consent-notes" className={styles.cardTitle}>
                Notes from your assistant
              </h3>
              <p className={styles.body}>{draft.assistantNotes}</p>
            </section>
          )}

          <ul className={styles.chips} aria-label="Also shared">
            {draft.ageRange && (
              <li>
                <Badge variant="neutral">{ageRangeLabel(draft.ageRange)}</Badge>
              </li>
            )}
            {draft.pregnancyWeeks != null && (
              <li>
                <Badge variant="neutral">{pregnancyLabel(draft.pregnancyWeeks)}</Badge>
              </li>
            )}
            <li>
              <Badge variant="accent">Topic: {categoryLabel(draft.category)}</Badge>
            </li>
          </ul>

          <p className={styles.note}>
            <Icon name="lock" size={18} className={styles.noteIcon} />
            <span>Never shared: your name, email, phone number or location.</span>
          </p>

          <Checkbox checked={agreed} onChange={(event) => setAgreed(event.target.checked)}>
            I agree to share this with a verified nurse or midwife.
          </Checkbox>

          <div className={styles.actions}>
            <Button fullWidth disabled={!agreed} onClick={handleContinue}>
              Continue
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
