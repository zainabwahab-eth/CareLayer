import { AUTH_RULES } from '@carelayer/shared';
import {
  CODE_LENGTH,
  describeDevice,
  readVerifyEmailState,
  type AuthEntryState,
  type VerifyEmailState,
} from '@web/auth/auth-flow';
import { hasErrorCode } from '@web/api/errors';
import { Alert } from '@web/components/Alert/Alert';
import { cx } from '@web/components/cx';
import { BackLink } from '@web/components/BackLink/BackLink';
import { Button } from '@web/components/Button/Button';
import { CodeInput } from '@web/components/CodeInput/CodeInput';
import { Icon } from '@web/components/Icon/Icon';
import auth from '@web/pages/public/auth.module.css';
import styles from '@web/pages/public/VerifyEmailPage.module.css';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useNurseApi } from '../../api/api-context';
import { APP, nurseAuthErrorMessage } from '../../auth/nurse-auth';
import { useAuth } from '../../auth/useAuth';
import { NurseAuthLayout } from '../../layouts/NurseAuthLayout';
import { paths } from '../../routes/paths';

/*
 * Verify email (no nurse frame; docs/TASKS.md §3: "Verify screen reuses W04's
 * layout"). Same behaviour as apps/web's W04: six boxes, resend countdown.
 * POST /auth/code/verify with app "nurses".
 */
export function VerifyEmailPage() {
  const location = useLocation();
  const flow = readVerifyEmailState(location.state);
  if (!flow) return <Navigate to={paths.join} replace />;
  return (
    <NurseAuthLayout>
      <VerifyForm key={`${flow.purpose}:${flow.email}`} flow={flow} />
    </NurseAuthLayout>
  );
}

const emptyCode = () => Array.from({ length: CODE_LENGTH }, () => '');

function VerifyForm({ flow }: { flow: VerifyEmailState }) {
  const api = useNurseApi();
  const { completeSignIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [digits, setDigits] = useState<string[]>(emptyCode);
  const [codeError, setCodeError] = useState<string>();
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
      completeSignIn(tokens); // GuestOnly sends her on.
    } catch (error) {
      setVerifying(false);
      setCodeError(nurseAuthErrorMessage(error));
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
      const next: VerifyEmailState = { ...flow, resendAvailableAt };
      navigate(location.pathname, { replace: true, state: next });
      setDigits(emptyCode());
      setCodeError(undefined);
      setNeedsNewCode(false);
      setNotice({ tone: 'success', message: `We sent a new code to ${flow.email}.` });
    } catch (error) {
      setNotice({ tone: 'error', message: nurseAuthErrorMessage(error) });
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

/* Same as apps/web's W04 (not exported there). */
function useSecondsUntil(iso: string): number {
  const target = Date.parse(iso);
  const [now, setNow] = useState(() => Date.now());
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
