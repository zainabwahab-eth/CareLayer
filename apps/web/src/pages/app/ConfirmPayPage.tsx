import {
  FREE_ANSWERS_PER_WOMAN,
  QUESTION_CLAIMS_CLOSE_MINUTES,
  type CreateQuestionBody,
  type CreateQuestionResponse,
} from '@carelayer/shared';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { hasErrorCode, isApiError } from '../../api/errors';
import { useApi } from '../../api/useApi';
import { useApiQuery } from '../../api/useApiQuery';
import {
  CONSENT_VERSION,
  draftFor,
  sharedFieldsFor,
  type PreparedDraft,
} from '../../ask-nurse/send-flow';
import { useSendFlow } from '../../ask-nurse/useSendFlow';
import { isSessionError } from '../../auth/auth-flow';
import { useAuth } from '../../auth/useAuth';
import { useSessionGuard } from '../../auth/useSessionGuard';
import type { EmergencyLocationState } from '../../chat/emergency-state';
import { useChat } from '../../chat/useChat';
import { Alert } from '../../components/Alert/Alert';
import { Button, ButtonLink } from '../../components/Button/Button';
import { Checkbox } from '../../components/Checkbox/Checkbox';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon/Icon';
import { useAppShell } from '../../layouts/app-shell';
import { consultationWaitingPath, paths } from '../../routes/paths';
import { categoryLabel } from '../../utils/categories';
import { formatNaira } from '../../utils/money';
import { createErrorMessage, isUncertainSend } from './send/flow-errors';
import { FlowScreen } from './send/FlowScreen';
import styles from './send/flow.module.css';

/*
 * W09 Confirm and send (Figma "W09 Confirm and pay").
 *
 * "Confirm and send" calls POST /questions with her consent, the signed draft
 * and her nurse choice (contract §8.1). Nothing is charged here: payment is on
 * delivery, when she opens the answer on W11, and the API's own agent pays over
 * x402 from her wallet. A question no one answers in 30 minutes costs nothing.
 */
export function ConfirmPayPage() {
  const chat = useChat();
  const flow = useSendFlow();
  const draft = draftFor(flow, chat.turns);
  // Sent: go to W10 (or W13). Checked first, so clearing the draft can never bounce her to W07.
  if (flow.finished) {
    return <Navigate to={flow.finished.to} state={flow.finished.state} replace />;
  }
  if (!draft || !flow.consented) return <Navigate to={paths.askConsent} replace />;
  return <ConfirmSend draft={draft} />;
}

type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  /** Something failed; nothing was sent. */
  | { status: 'error'; message: string; action?: 'review' | 'choose' }
  /** The request may have reached the API: check History before sending again. */
  | { status: 'uncertain' };

function ConfirmSend({ draft: prepared }: { draft: PreparedDraft }) {
  const { draft, draftToken, offer } = prepared;
  const api = useApi();
  const chat = useChat();
  const flow = useSendFlow();
  const navigate = useNavigate();
  const { sessionExpired } = useAuth();
  const { refreshWallet } = useAppShell();

  const wallet = useApiQuery((a) => a.wallet.get());
  const settings = useApiQuery((a) => a.me.getSettings());
  useSessionGuard(wallet.error, settings.error);

  const [send, setSend] = useState<SendState>({ status: 'idle' });
  const [approved, setApproved] = useState(false);
  const [showApprovalError, setShowApprovalError] = useState(false);
  /** The API said the price is above her limit, even if the quote did not. */
  const [limitFromApi, setLimitFromApi] = useState<number | null>(null);

  const isFree = offer.isFree;
  const price = offer.price;
  const limitKobo = limitFromApi ?? settings.data?.spendingLimitPerAnswerKobo ?? null;
  const needsApproval =
    !isFree &&
    (limitFromApi !== null ||
      (limitKobo !== null ? price.kobo > limitKobo : offer.exceedsSpendingLimit));
  const balanceAfterKobo = wallet.data ? wallet.data.balance.kobo - price.kobo : null;
  const shortOfFunds = !isFree && balanceAfterKobo !== null && balanceAfterKobo < 0;
  const walletNotReady = !isFree && wallet.data?.status === 'pending';

  const answeredBy =
    flow.choice.kind === 'chosen_nurse'
      ? flow.choice.nurse.fullName
      : 'First available nurse or midwife';

  const onConfirm = async () => {
    if (send.status === 'sending') return;
    if (needsApproval && !approved) {
      setShowApprovalError(true);
      return;
    }
    setSend({ status: 'sending' });

    const body: CreateQuestionBody = {
      originalText: draft.originalText,
      source: 'web',
      consent: { sharedFields: sharedFieldsFor(draft), consentVersion: CONSENT_VERSION },
      nurseSelection: flow.choice.kind,
      ...(flow.choice.kind === 'chosen_nurse' ? { chosenNurseId: flow.choice.nurse.id } : {}),
      femaleOnly: flow.femaleOnly,
      ...(needsApproval && approved ? { approvedAboveLimit: true } : {}),
      draftToken,
    };

    let response: CreateQuestionResponse;
    try {
      response = await api.questions.create(body);
    } catch (error) {
      if (isSessionError(error)) {
        sessionExpired();
        return;
      }
      if (isUncertainSend(error)) {
        setSend({ status: 'uncertain' });
        return;
      }
      if (hasErrorCode(error, 'SPENDING_LIMIT_EXCEEDED')) {
        const limit = Number(error.details?.spendingLimitKobo);
        setLimitFromApi(Number.isFinite(limit) ? limit : (limitKobo ?? 0));
        setApproved(false);
        setSend({
          status: 'error',
          message: 'This answer costs more than your limit per answer. Approve it below to send.',
        });
        return;
      }
      if (hasErrorCode(error, 'CHOSEN_NURSE_UNAVAILABLE')) {
        setSend({
          status: 'error',
          message: `${answeredBy} is not available right now. Choose someone else, or the first available nurse.`,
          action: 'choose',
        });
        return;
      }
      if (
        hasErrorCode(error, 'CONSENT_REQUIRED') ||
        (isApiError(error) &&
          error.code === 'VALIDATION_FAILED' &&
          (error.details?.field === 'draftToken' || error.details?.field === 'originalText'))
      ) {
        setSend({
          status: 'error',
          message:
            'This review has expired. Look over your question again, then send it. Nothing was sent.',
          action: 'review',
        });
        return;
      }
      setSend({ status: 'error', message: createErrorMessage(error) });
      return;
    }

    // Sent. finish() clears the draft and the guard above takes her on, in one update.
    chat.dismissOffer();
    if (response.kind === 'emergency') {
      // Red flag found on the final check: free, nothing queued, nothing to pay.
      const state: EmergencyLocationState = { emergency: response };
      flow.finish(paths.emergency, state);
      return;
    }
    // Free answers left changes as soon as a free question is in flight.
    refreshWallet();
    flow.finish(consultationWaitingPath(response.id));
  };

  const reviewAgain = () => {
    flow.clearDraft();
    navigate(paths.askConsent, { replace: true });
  };

  return (
    <FlowScreen
      title="Send to a nurse"
      subtitle="Step 3 of 3"
      step={3}
      backTo={paths.askChoose}
      backLabel="Back to step 2"
      footer={
        <>
          <p className={styles.lockNote}>
            <Icon name="lock" size={16} className={styles.noteIcon} />
            {isFree
              ? 'Free answers are paid to the nurse by CareLayer. Your answer appears in History.'
              : 'Paid in USDC on Stellar through x402. Your receipt appears in History.'}
          </p>
          {send.status === 'uncertain' ? (
            <>
              <ButtonLink to={paths.history} fullWidth>
                Check History
              </ButtonLink>
              <Button variant="ghost" fullWidth onClick={() => void onConfirm()}>
                It’s not there: send again
              </Button>
            </>
          ) : (
            <>
              <Button
                fullWidth
                onClick={() => void onConfirm()}
                disabled={send.status === 'sending'}
                aria-busy={send.status === 'sending'}
              >
                {send.status === 'sending' ? 'Sending…' : 'Confirm and send'}
              </Button>
              <Button
                variant="ghost"
                fullWidth
                onClick={() => navigate(paths.askChoose)}
                disabled={send.status === 'sending'}
              >
                Back
              </Button>
            </>
          )}
        </>
      }
    >
      <h2 className={styles.heading}>Confirm and send</h2>

      <dl className={styles.summary}>
        <Row label="Answered by" value={answeredBy} />
        <Row label="Topic" value={categoryLabel(draft.category)} />
        <Row label="Answer price" value={isFree ? 'Free' : formatNaira(price)} large />
        <Row
          label="Paid from"
          value={
            isFree
              ? `Free answer (${offer.freeAnswersRemaining} of ${FREE_ANSWERS_PER_WOMAN} left)`
              : 'CareLayer balance'
          }
        />
        {!isFree && (
          <Row
            label="Balance after"
            value={
              balanceAfterKobo === null
                ? wallet.status === 'error'
                  ? 'Not available'
                  : 'Checking…'
                : formatNaira(balanceAfterKobo)
            }
          />
        )}
        <Row
          label="Your limit per answer"
          value={
            limitKobo === null
              ? settings.status === 'error'
                ? 'Not available'
                : 'Checking…'
              : formatNaira(limitKobo)
          }
        />
      </dl>

      <div className={styles.accentNote}>
        <Icon name="clock" size={22} className={styles.noteIcon} />
        <div className={styles.noteText}>
          <p className={styles.noteTitle}>Nothing is charged now</p>
          <p className={styles.noteBody}>
            {isFree
              ? `This answer is free. If no one answers within ${QUESTION_CLAIMS_CLOSE_MINUTES} minutes, you keep your free answer.`
              : `${formatNaira(price)} moves only when your answer is delivered. If no one answers within ${QUESTION_CLAIMS_CLOSE_MINUTES} minutes, you pay nothing.`}
          </p>
        </div>
      </div>

      {(shortOfFunds || walletNotReady) && (
        <Alert tone="info">
          {walletNotReady
            ? 'Your wallet is still being set up. '
            : `Your balance is ${formatNaira(wallet.data!.balance)}. `}
          Top up before your answer arrives so it can be paid when you open it.{' '}
          <Link to={paths.wallet} className={styles.link}>
            Top up
          </Link>
        </Alert>
      )}

      {needsApproval && (
        <Checkbox
          checked={approved}
          onChange={(event) => {
            setApproved(event.target.checked);
            if (event.target.checked) setShowApprovalError(false);
          }}
          error={
            showApprovalError
              ? 'Approve the price to send, or go back and change your limit.'
              : undefined
          }
        >
          I approve paying {formatNaira(price)}, which is above my limit of{' '}
          {limitKobo === null ? 'my limit' : formatNaira(limitKobo)} per answer.
        </Checkbox>
      )}

      {send.status === 'error' && (
        <div className={styles.errorBlock}>
          <Alert tone="error">{send.message}</Alert>
          {send.action === 'review' && (
            <Button variant="secondary" onClick={reviewAgain}>
              Review my question
            </Button>
          )}
          {send.action === 'choose' && (
            <Button variant="secondary" onClick={() => navigate(paths.askChoose)}>
              Choose again
            </Button>
          )}
        </div>
      )}

      {send.status === 'uncertain' && (
        <Alert tone="error">
          We could not confirm whether your question was sent. Check History first, so it isn’t sent
          twice.
        </Alert>
      )}
    </FlowScreen>
  );
}

function Row({ label, value, large = false }: { label: string; value: string; large?: boolean }) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowLabel}>{label}</dt>
      <dd className={cx(styles.rowValue, large && styles.rowValueLarge)}>{value}</dd>
    </div>
  );
}
