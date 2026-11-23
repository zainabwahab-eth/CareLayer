import {
  normaliseEmail,
  readEntryState,
  validateEmail,
  type AuthEntryState,
  type VerifyEmailState,
} from '@web/auth/auth-flow';
import { hasErrorCode, isApiError } from '@web/api/errors';
import { Alert } from '@web/components/Alert/Alert';
import { cx } from '@web/components/cx';
import { Button } from '@web/components/Button/Button';
import { Input } from '@web/components/Input/Input';
import auth from '@web/pages/public/auth.module.css';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useNurseApi } from '../../api/api-context';
import { APP, nurseAuthErrorMessage } from '../../auth/nurse-auth';
import { NurseAuthLayout } from '../../layouts/NurseAuthLayout';
import { useFocusAfterRender } from '../../hooks/useFocusAfterRender';
import { paths } from '../../routes/paths';
import { useGoogleAuth } from './useGoogleAuth';

/*
 * Nurse log in (no Figma frame; docs/TASKS.md §3): N01's form side with the
 * title "Welcome back" and the footer "New here? Join as a nurse or midwife".
 * Email -> POST /auth/code/request (purpose "login", app "nurses") -> verify.
 */
export function LogInPage() {
  const api = useNurseApi();
  const google = useGoogleAuth('login');
  const navigate = useNavigate();
  const location = useLocation();
  const entry = readEntryState(location.state);

  const [email, setEmail] = useState(entry.email ?? '');
  const [emailError, setEmailError] = useState<string>();
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<{ message: string; notFound: boolean }>();
  const [sending, setSending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const focusLater = useFocusAfterRender();
  const busy = sending || google.pending;
  const joinState: AuthEntryState = { from: entry.from, email: email.trim() || undefined };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setFormError(undefined);
    const error = validateEmail(email);
    setEmailError(error);
    if (error) return emailRef.current?.focus();

    const normalisedEmail = normaliseEmail(email);
    setSending(true);
    try {
      const { resendAvailableAt } = await api.auth.requestCode({
        email: normalisedEmail,
        purpose: 'login',
        app: APP,
      });
      const next: VerifyEmailState = {
        email: normalisedEmail,
        purpose: 'login',
        resendAvailableAt,
        from: entry.from,
      };
      navigate(paths.verifyEmail, { state: next });
    } catch (caught) {
      setSending(false);
      if (hasErrorCode(caught, 'VALIDATION_FAILED') && isApiError(caught)) {
        setEmailError(caught.message);
        focusLater(() => emailRef.current);
        return;
      }
      setFormError({
        message: nurseAuthErrorMessage(caught),
        notFound: hasErrorCode(caught, 'ACCOUNT_NOT_FOUND'),
      });
    }
  };

  const handleGoogle = async () => {
    if (busy) return;
    setFormError(undefined);
    const { error } = await google.start();
    if (error) {
      setFormError({
        message: nurseAuthErrorMessage(error),
        notFound: hasErrorCode(error, 'ACCOUNT_NOT_FOUND'),
      });
    }
  };

  return (
    <NurseAuthLayout>
      <div className={cx(auth.page, auth.narrow)}>
        <div className={auth.heading}>
          <h1 className={auth.title}>Welcome back</h1>
          <p className={auth.lede}>Log in with your email. We’ll send you a code, no password.</p>
        </div>

        {entry.notice === 'session-expired' && !formError && (
          <Alert tone="info">Your session ended. Log in again to carry on.</Alert>
        )}
        {formError && (
          <Alert tone="error">
            {formError.message}{' '}
            {formError.notFound && (
              <Link to={paths.signUp} state={joinState}>
                Join instead
              </Link>
            )}
          </Alert>
        )}

        {google.available && (
          <>
            <Button
              variant="secondary"
              fullWidth
              onClick={handleGoogle}
              disabled={busy}
              aria-busy={google.pending || undefined}
            >
              {google.pending ? 'Connecting to Google…' : 'Continue with Google'}
            </Button>
            <p className={auth.divider}>or with email</p>
          </>
        )}

        <form className={auth.form} onSubmit={handleSubmit} noValidate>
          <Input
            ref={emailRef}
            label="Email address"
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            error={emailError}
            disabled={busy}
            onChange={(event) => {
              setEmail(event.target.value);
              if (submitted) setEmailError(validateEmail(event.target.value));
            }}
          />
          <Button type="submit" fullWidth disabled={busy} aria-busy={sending || undefined}>
            {sending ? 'Sending your code…' : 'Send me a code'}
          </Button>
          <p className={auth.helper}>We’ll email you a 6-digit code. No password needed.</p>
        </form>

        <p className={auth.switch}>
          New here?
          <Link to={paths.signUp} state={joinState} className={auth.textLink}>
            Join as a nurse or midwife
          </Link>
        </p>
      </div>
    </NurseAuthLayout>
  );
}
