import { AUTH_RULES } from '@carelayer/shared';
import { isApiError } from '@web/api/errors';
import { isSessionError } from '@web/auth/auth-flow';
import { Alert } from '@web/components/Alert/Alert';
import { Button } from '@web/components/Button/Button';
import { CodeInput } from '@web/components/CodeInput/CodeInput';
import { useState, type FormEvent } from 'react';
import { useNurseApi } from '../api/api-context';
import { useAuth } from '../auth/useAuth';
import styles from './workspace.module.css';

/*
 * "Confirm it's you" before a withdrawal or a payout wallet change (contract §2, §10, §12):
 * POST /auth/code/request { purpose: "step_up" } emails a code to her own address,
 * then POST /auth/step-up { code } makes this session "fresh" for 5 minutes.
 */
export function StepUp({
  reason,
  onConfirmed,
}: {
  /** e.g. "Before you withdraw". */
  reason: string;
  onConfirmed: (freshUntil: string) => void;
}) {
  const api = useNurseApi();
  const { state, sessionExpired } = useAuth();
  const email = state.user?.email ?? '';
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [digits, setDigits] = useState<string[]>(() => Array(AUTH_RULES.codeLength).fill(''));
  const [error, setError] = useState<string>();

  const sendCode = async () => {
    setSending(true);
    setError(undefined);
    try {
      await api.auth.requestCode({ email, purpose: 'step_up', app: 'nurses' });
      setSent(true);
      setDigits(Array(AUTH_RULES.codeLength).fill(''));
    } catch (e) {
      if (isSessionError(e)) sessionExpired();
      setError(
        isApiError(e) && e.code === 'RATE_LIMITED'
          ? e.message
          : isApiError(e) && e.status === 0
            ? 'Could not reach CareLayer. Check your connection and try again.'
            : 'We could not send a code. Please try again.',
      );
    } finally {
      setSending(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    const code = digits.join('');
    if (code.length !== AUTH_RULES.codeLength) {
      setError('Enter the 6-digit code.');
      return;
    }
    setVerifying(true);
    setError(undefined);
    try {
      const { freshUntil } = await api.auth.stepUp({ code });
      onConfirmed(freshUntil);
    } catch (e) {
      if (isSessionError(e)) sessionExpired();
      setVerifying(false);
      if (isApiError(e) && (e.code === 'CODE_INVALID' || e.code === 'CODE_EXPIRED')) {
        setError(e.message);
      } else if (isApiError(e) && e.code === 'CODE_ATTEMPTS_EXCEEDED') {
        setError('Too many wrong tries. Ask for a new code.');
        setSent(false);
      } else {
        setError('We could not check the code. Please try again.');
      }
    }
  };

  return (
    <section className={styles.card} aria-label="Confirm it’s you">
      <h2 className={styles.cardTitle}>Confirm it’s you</h2>
      <p className={styles.bodySmall}>
        {reason}, we email a 6-digit code to <strong>{email}</strong>. This keeps your money safe if
        someone else has your phone.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {!sent ? (
        <Button onClick={() => void sendCode()} disabled={sending}>
          {sending ? 'Sending…' : 'Email me a code'}
        </Button>
      ) : (
        <form
          className={styles.stack}
          style={{ gap: 'var(--space-12)' }}
          onSubmit={(e) => void verify(e)}
        >
          <CodeInput
            digits={digits}
            onChange={setDigits}
            label="Code from your email"
            disabled={verifying}
            autoFocus
          />
          <Button type="submit" disabled={verifying}>
            {verifying ? 'Checking…' : 'Confirm'}
          </Button>
          <button
            type="button"
            className={styles.link}
            onClick={() => void sendCode()}
            disabled={sending}
          >
            Send a new code
          </button>
        </form>
      )}
    </section>
  );
}
