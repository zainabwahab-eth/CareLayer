import { AUTH_RULES } from '@carelayer/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { hasErrorCode } from '../../api/errors';
import { useApi } from '../../api/useApi';
import {
  APP,
  CODE_LENGTH,
  authErrorMessage,
  describeDevice,
  readVerifyEmailState,
  type AuthEntryState,
  type VerifyEmailState,
} from '../../auth/auth-flow';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/Alert/Alert';
import { BackLink } from '../../components/BackLink/BackLink';
import { Button } from '../../components/Button/Button';
import { CodeInput } from '../../components/CodeInput/CodeInput';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon/Icon';
import { paths } from '../../routes/paths';
import auth from './auth.module.css';
import styles from './VerifyEmailPage.module.css';

/*
 * W04 Verify email (Figma: "W04 Verify email", "D-W04").
 * Shared by sign-up and log-in: the 6-digit code from POST /auth/code/request
 * goes to POST /auth/code/verify. On success the session starts and GuestOnly
 * sends her on to Home (or wherever she was heading).
 *
 * The email and purpose arrive in router state from W03 / Log in. Opening this
 * URL directly (no state) goes back to Sign up.
 */
const emptyCode = () => Array.from({ length: CODE_LENGTH }, () => '');

export function VerifyEmailPage() {
  const location = useLocation();
  const flow = readVerifyEmailState(location.state);
  if (!flow) return <Navigate to={paths.signUp} replace />;
  // Key by email + purpose so a new flow always starts with a clean form.
  return <VerifyEmailForm key={`${flow.purpose}:${flow.email}`} flow={flow} />;
}

function VerifyEmailForm({ flow }: { flow: VerifyEmailState }) {
  const api = useApi();
  const { completeSignIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [digits, setDigits] = useState<string[]>(emptyCode);
  const [codeError, setCodeError] = useState<string>();
  /** Code is used up (expired / too many tries): verifying is pointless until a resend. */
  const [needsNewCode, setNeedsNewCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string }>();
  const secondsLeft = useSecondsUntil(flow.resendAvailableAt);

  const code = digits.join('');
  const backTo = flow.purpose === 'signup' ? paths.signUp : paths.logIn;
  const backState: AuthEntryState = { from: flow.from, email: flow.email };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (verifying) return;
    setNotice(undefined);
    if (code.length !== CODE_LENGTH) {
      setCodeError(`Enter all ${CODE_LENGTH} digits from the email.`);
      return;
    }
    setCodeError(undefined);
    setVerifying(true);
    try {
      const tokens = await api.auth.verifyCode({
        email: flow.email,
        code,
        purpose: flow.purpose,
        app: APP,
        name: flow.name,
        deviceName: describeDevice(),
      });
      completeSignIn(tokens); // GuestOnly redirects; this component unmounts.
    } catch (error) {
      setVerifying(false);
      setCodeError(authErrorMessage(error));
      if (hasErrorCode(error, 'CODE_EXPIRED') || hasErrorCode(error, 'CODE_ATTEMPTS_EXCEEDED')) {
        setNeedsNewCode(true);
      }
      setDigits(emptyCode());
    }
  };

  const handleResend = async () => {
    if (resending || secondsLeft > 0) return;
    setNotice(undefined);
    setResending(true);
    try {
      const { resendAvailableAt } = await api.auth.requestCode({
        email: flow.email,
        purpose: flow.purpose,
        app: APP,
        name: flow.name,
      });
      // Keep the new cooldown in the history entry so a reload remembers it.
      const next: VerifyEmailState = { ...flow, resendAvailableAt };
      navigate(location.pathname, { replace: true, state: next });
      setDigits(emptyCode());
      setCodeError(undefined);
      setNeedsNewCode(false);
      setNotice({ tone: 'success', message: `We sent a new code to ${flow.email}.` });
    } catch (error) {
      setNotice({ tone: 'error', message: authErrorMessage(error) });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className={cx(auth.page, auth.narrow)}>
      <BackLink
        to={backTo}
        state={backState}
        label={flow.purpose === 'signup' ? 'Back to sign up' : 'Back to log in'}
      />

      <span className={styles.iconCircle} aria-hidden>
        <Icon name="mail" size={30} />
      </span>

      <div className={auth.heading}>
        <h1 className={auth.title}>Check your email</h1>
        <p className={auth.lede}>
          We sent a {CODE_LENGTH}-digit code to <strong>{flow.email}</strong>. It expires in{' '}
          {AUTH_RULES.codeTtlMinutes} minutes.
        </p>
      </div>

      {notice && <Alert tone={notice.tone}>{notice.message}</Alert>}

      <form className={auth.form} onSubmit={handleSubmit} noValidate>
        <CodeInput
          digits={digits}
          onChange={(next) => {
            setDigits(next);
            if (codeError && !needsNewCode) setCodeError(undefined);
          }}
          error={codeError}
          disabled={verifying || needsNewCode}
          autoFocus
        />
        <Button
          type="submit"
          fullWidth
          disabled={verifying || needsNewCode}
          aria-busy={verifying || undefined}
        >
          {verifying ? 'Checking your code…' : 'Verify and continue'}
        </Button>
      </form>

      <p className={styles.resend}>
        Didn’t get it?
        {secondsLeft > 0 ? (
          <span className={styles.countdown} aria-live="off">
            Resend in {formatCountdown(secondsLeft)}
          </span>
        ) : (
          <button
            type="button"
            className={auth.textButton}
            onClick={handleResend}
            disabled={resending}
          >
            {resending ? 'Sending…' : 'Resend code'}
          </button>
        )}
      </p>
    </div>
  );
}

/** Whole seconds until `iso` (0 once passed). Re-renders every second. */
function useSecondsUntil(iso: string): number {
  const target = Date.parse(iso);
  const [now, setNow] = useState(() => Date.now());

  // Always ticking (cheap), so `now` is never more than a second stale when a resend moves the target.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return Number.isNaN(target) ? 0 : Math.max(0, Math.ceil((target - now) / 1000));
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
