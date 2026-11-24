import { CHAT_LIMITS } from '@carelayer/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useApi } from '../../api/useApi';
import { draftFor, threadKeyOf, type PreparedDraft } from '../../ask-nurse/send-flow';
import { useSendFlow } from '../../ask-nurse/useSendFlow';
import { isSessionError } from '../../auth/auth-flow';
import { useAuth } from '../../auth/useAuth';
import type { EmergencyLocationState } from '../../chat/emergency-state';
import { useChat } from '../../chat/useChat';
import { Alert } from '../../components/Alert/Alert';
import { Badge } from '../../components/Badge/Badge';
import { Button } from '../../components/Button/Button';
import { Checkbox } from '../../components/Checkbox/Checkbox';
import { Icon } from '../../components/Icon/Icon';
import { paths } from '../../routes/paths';
import { categoryLabel } from '../../utils/categories';
import { draftErrorMessage } from './send/flow-errors';
import { FlowScreen } from './send/FlowScreen';
import styles from './send/flow.module.css';
import { ageRangeLabel, pregnancyWeeksLabel } from './send/labels';

/*
 * W07 Consent (Figma "W07 Consent").
 *
 * POST /chat/draft turns her messages into exactly what a nurse will receive
 * (contract §7). She sees all of it here, and nothing is sent until she ticks
 * the box and continues; the question itself is only created on W09.
 * The draft re-checks the whole question for red flags: an emergency goes
 * straight to W13 and never into the paid nurse queue.
 */
export function ConsentPage() {
  const chat = useChat();
  // Nothing to consent to without her question (opened directly, or after a reload:
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

  return (
    <FlowScreen
      title="Send to a nurse"
      subtitle="Step 1 of 3"
      step={1}
      backTo={paths.ask}
      backLabel="Back to the chat"
      footer={
        draft && (
          <>
            <Checkbox
              checked={agreed}
              onChange={(event) => {
                setAgreed(event.target.checked);
                if (event.target.checked) setShowConsentError(false);
              }}
              error={
                showConsentError
                  ? 'Tick the box to agree before your question can be sent.'
                  : undefined
              }
            >
              I agree to share this with a verified nurse or midwife.
            </Checkbox>
            <Button fullWidth onClick={onContinue}>
              Continue
            </Button>
          </>
        )
      }
    >
      <h2 className={styles.heading}>Here’s exactly what the nurse or midwife will see</h2>

      {draft ? (
        <DraftPreview draft={draft} />
      ) : load.status === 'error' ? (
        <div className={styles.errorBlock}>
          <Alert tone="error">{load.message}</Alert>
          <div className={styles.actionsRow}>
            <Button onClick={() => void requestDraft()}>Try again</Button>
            <Button variant="ghost" onClick={() => navigate(paths.ask)}>
              Back to the chat
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.loading} role="status">
          <p className={styles.lead}>
            Preparing your question for a nurse. This can take a few seconds.
          </p>
        </div>
      )}
    </FlowScreen>
  );
}

function DraftPreview({ draft: { draft } }: { draft: PreparedDraft }) {
  return (
    <>
      <section className={styles.card} aria-labelledby="w07-question">
        <div className={styles.cardHead}>
          <h3 id="w07-question" className={styles.cardLabel}>
            Your question
          </h3>
          <Link
            to={paths.ask}
            className={styles.editLink}
            aria-label="Edit your question in the chat"
          >
            <Icon name="edit" size={14} />
            Edit
          </Link>
        </div>
        <p className={styles.questionText}>{draft.cleanedText}</p>
        <p className={styles.caption}>Spelling tidied. Nothing removed or shortened.</p>
      </section>

      {draft.assistantNotes && (
        <section className={styles.softCard} aria-labelledby="w07-notes">
          <h3 id="w07-notes" className={styles.cardLabel}>
            Notes from your assistant
          </h3>
          <p className={styles.bodyText}>{draft.assistantNotes}</p>
        </section>
      )}

      <ul className={styles.chips} aria-label="Also shared">
        {draft.ageRange && (
          <li>
            <Badge variant="neutral">{ageRangeLabel(draft.ageRange)}</Badge>
          </li>
        )}
        {draft.pregnancyWeeks !== null && (
          <li>
            <Badge variant="neutral">{pregnancyWeeksLabel(draft.pregnancyWeeks)}</Badge>
          </li>
        )}
        <li>
          <Badge variant="neutral">Topic: {categoryLabel(draft.category)}</Badge>
        </li>
      </ul>

      <p className={styles.privacyNote}>
        <Icon name="lock" size={20} className={styles.noteIcon} />
        Never shared: your name, email, phone number or location.
      </p>
    </>
  );
}
