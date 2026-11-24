import { QUESTION_CLAIMS_CLOSE_MINUTES } from '@carelayer/shared';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { hasErrorCode, isApiError } from '../../api/errors';
import { useApi } from '../../api/useApi';
import { useApiQuery } from '../../api/useApiQuery';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { CONSENT_VERSION, isDraftExpired, sharedFieldsFor } from '../../chat/ask-request';
import type { EmergencyLocationState } from '../../chat/emergency-state';
import { useChat } from '../../chat/useChat';
import { Alert } from '../../components/Alert/Alert';
import { Button } from '../../components/Button/Button';
import { Checkbox } from '../../components/Checkbox/Checkbox';
import { Icon } from '../../components/Icon/Icon';
import { consultationWaitingPath, paths } from '../../routes/paths';
import { categoryLabel } from '../../utils/categories';
import { formatNaira } from '../../utils/money';
import { shortNurseName } from '../../utils/nurses';
import styles from './ask/AskFlow.module.css';
import { FlowHeader } from './ask/FlowHeader';
import { flowErrorMessage } from './ask/flow-errors';

type Failure = { message: string; action?: 'choose' | 'review' };

/**
 * W09 Confirm and send (Figma: W09 / D-W09). Sends POST /questions with the W07 draft
 * token, her consent and her W08 choice. Free to send: pay on delivery, so nothing is
 * charged until she opens the answer (W11), and nothing at all if no one answers.
 */
export function ConfirmPayPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { request, setRequest } = useChat();
  const wallet = useApiQuery((client) => client.wallet.get());
  const settings = useApiQuery((client) => client.me.getSettings());
  const [approved, setApproved] = useState(false);
  const [limitRefused, setLimitRefused] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sendError, setSendError] = useState<unknown>(null);
  /** Set once sent: the cleared request must not bounce her back to W07 on the way out. */
  const [sent, setSent] = useState(false);
  useSessionGuard(wallet.error, settings.error, sendError);

  if (!request?.consented) {
    return sent ? null : <Navigate to={paths.askConsent} replace />;
  }

  const { draft, offer } = request;
  const price = formatNaira(offer.price);
  const needsApproval = !offer.isFree && (offer.exceedsSpendingLimit || limitRefused);
  const limitKobo = settings.data?.spendingLimitPerAnswerKobo;
  const balanceKobo = wallet.data?.balance.kobo;
  const balanceAfter =
    balanceKobo == null ? null : offer.isFree ? balanceKobo : balanceKobo - offer.price.kobo;
  const answeredBy =
    request.nurseSelection === 'chosen_nurse' && request.chosenNurse
      ? shortNurseName(request.chosenNurse.fullName)
      : 'First available';

  const reviewAgain = () => {
    // Mark the draft stale: W07 fetches a fresh one and keeps her W08 choices.
    setRequest((current) =>
      current ? { ...current, consented: false, draftExpiresAt: new Date(0).toISOString() } : null,
    );
    navigate(paths.askConsent);
  };

  const handleSend = async () => {
    if (sending || (needsApproval && !approved)) return;
    if (isDraftExpired(request)) {
      setFailure({
        message: 'This draft has expired. Review your question again before sending it.',
        action: 'review',
      });
      return;
    }
    setSending(true);
    setFailure(null);
    setSendError(null);
    try {
      const created = await api.questions.create({
        originalText: draft.originalText,
        source: 'web',
        consent: { sharedFields: sharedFieldsFor(draft), consentVersion: CONSENT_VERSION },
        nurseSelection: request.nurseSelection,
        chosenNurseId:
          request.nurseSelection === 'chosen_nurse' ? request.chosenNurse?.id : undefined,
        femaleOnly: request.femaleOnly,
        approvedAboveLimit: needsApproval ? approved : undefined,
        draftToken: request.draftToken,
      });
      if (created.kind === 'emergency') {
        const state: EmergencyLocationState = { emergency: created };
        navigate(paths.emergency, { state, replace: true });
        return;
      }
      setSent(true);
      navigate(consultationWaitingPath(created.id), { replace: true });
      // Sent: the draft is used up, so going back never sends it twice.
      setRequest(null);
    } catch (error) {
      setSending(false);
      setSendError(error);
      if (hasErrorCode(error, 'SPENDING_LIMIT_EXCEEDED')) {
        setLimitRefused(true);
        setFailure({ message: 'This answer costs more than your limit. Approve it to send.' });
      } else if (hasErrorCode(error, 'CHOSEN_NURSE_UNAVAILABLE')) {
        setFailure({
          message: 'That nurse is not available right now. Choose someone else or First available.',
          action: 'choose',
        });
      } else if (
        isApiError(error) &&
        error.code === 'VALIDATION_FAILED' &&
        error.details?.field === 'draftToken'
      ) {
        setFailure({ message: error.message, action: 'review' });
      } else {
        setFailure({
          message: flowErrorMessage(error, 'Your question was not sent. Please try again.'),
        });
      }
    }
  };

  return (
    <div className={styles.page}>
      <FlowHeader title="Send to a nurse" subtitle="Step 3 of 3" backTo={paths.askChoose} />

      <h2 className={styles.title}>Confirm and send</h2>

      <section className={styles.card} aria-label="Summary">
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>Answered by</dt>
            <dd>{answeredBy}</dd>
          </div>
          <div className={styles.row}>
            <dt>Topic</dt>
            <dd>{categoryLabel(draft.category)}</dd>
          </div>
          <div className={styles.row}>
            <dt>Answer price</dt>
            <dd>{offer.isFree ? 'Free' : price}</dd>
          </div>
          <div className={styles.row}>
            <dt>Paid from</dt>
            <dd>
              {offer.isFree
                ? `Free answer (${offer.freeAnswersRemaining} left)`
                : 'CareLayer balance'}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>Balance after</dt>
            <dd>{balanceAfter == null ? '–' : formatNaira(Math.max(balanceAfter, 0))}</dd>
          </div>
          <div className={styles.row}>
            <dt>Your limit per answer</dt>
            <dd>{limitKobo == null ? '–' : formatNaira(limitKobo)}</dd>
          </div>
        </dl>
      </section>

      <p className={styles.warning}>
        <Icon name="wallet" size={18} className={styles.noteIcon} />
        <span>
          {offer.isFree
            ? `Nothing is charged: this answer is free. If no one answers within ${QUESTION_CLAIMS_CLOSE_MINUTES} minutes, your free answer is not used.`
            : `Nothing is charged now. ${price} moves only when your answer is delivered. If no one answers within ${QUESTION_CLAIMS_CLOSE_MINUTES} minutes, you pay nothing.`}
        </span>
      </p>

      {!offer.isFree && balanceAfter != null && balanceAfter < 0 && (
        <Alert tone="info">
          Your balance is lower than the price. You can send now and{' '}
          <Link to={paths.wallet} className={styles.link}>
            top up
          </Link>{' '}
          before you open the answer.
        </Alert>
      )}

      {needsApproval && (
        <Checkbox checked={approved} onChange={(event) => setApproved(event.target.checked)}>
          Pay {price} for this answer, above my limit
          {limitKobo == null ? '' : ` of ${formatNaira(limitKobo)}`}.
        </Checkbox>
      )}

      {failure && (
        <div className={styles.errorBlock}>
          <Alert tone="error">{failure.message}</Alert>
          {failure.action === 'choose' && (
            <Button variant="secondary" onClick={() => navigate(paths.askChoose)}>
              Choose again
            </Button>
          )}
          {failure.action === 'review' && (
            <Button variant="secondary" onClick={reviewAgain}>
              Review my question
            </Button>
          )}
        </div>
      )}

      {!offer.isFree && (
        <p className={styles.small}>
          Paid in USDC on Stellar through x402. Your receipt appears in History.
        </p>
      )}

      <div className={styles.actions}>
        <Button
          fullWidth
          disabled={sending || (needsApproval && !approved)}
          onClick={() => void handleSend()}
        >
          {sending ? 'Sending…' : 'Confirm and send'}
        </Button>
        <Button variant="ghost" fullWidth onClick={() => navigate(paths.askChoose)}>
          Back
        </Button>
      </div>
    </div>
  );
}
