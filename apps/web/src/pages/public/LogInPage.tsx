import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { hasErrorCode } from '../../api/errors';
import { useApi } from '../../api/useApi';
import {
  APP,
  authErrorMessage,
  describeDevice,
  normaliseEmail,
  readEntryState,
  validateEmail,
  type AuthEntryState,
  type VerifyEmailState,
} from '../../auth/auth-flow';
import { googleSignIn } from '../../auth/google';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/Alert/Alert';
import { Button } from '../../components/Button/Button';
import { cx } from '../../components/cx';
import { Input } from '../../components/Input/Input';
import { Logo } from '../../components/Logo/Logo';
import { paths } from '../../routes/paths';
import auth from './auth.module.css';

/*
 * Log in. No Figma frame exists, so this mirrors W03 Sign up (same layout,
 * components and copy style) with only the email field.
 * Email -> POST /auth/code/request (purpose "login") -> W04 Verify email.
 * Or "Continue with Google" -> POST /auth/google (mode "login").
 */
type Pending = 'email' | 'google' | null;

export function LogInPage() {
  const api = useApi();
  const { completeSignIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const entry = readEntryState(location.state);

  const [email, setEmail] = useState(entry.email ?? '');
  const [emailError, setEmailError] = useState<string>();
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<{ message: string; noAccount: boolean }>();
  const [pending, setPending] = useState<Pending>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const signUpState: AuthEntryState = { from: entry.from, email: email.trim() || undefined };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    setFormError(undefined);

    const error = validateEmail(email);
    setEmailError(error);
    if (error) return emailRef.current?.focus();

    const normalisedEmail = normaliseEmail(email);
    setPending('email');
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
    } catch (requestError) {
      setPending(null);
      if (hasErrorCode(requestError, 'VALIDATION_FAILED')) {
        setEmailError(requestError.message);
        return;
      }
      setFormError({
        message: authErrorMessage(requestError),
        noAccount: hasErrorCode(requestError, 'ACCOUNT_NOT_FOUND'),
      });
    }
  };

  const handleGoogle = async () => {
    if (pending) return;
    setFormError(undefined);
    setPending('google');
    try {
      const idToken = await googleSignIn.getIdToken();
      const tokens = await api.auth.signInWithGoogle({
        idToken,
        mode: 'login',
        app: APP,
        deviceName: describeDevice(),
      });
      completeSignIn(tokens); // GuestOnly then sends her on.
    } catch (googleError) {
      setPending(null);
      setFormError({
        message: authErrorMessage(googleError),
        noAccount: hasErrorCode(googleError, 'ACCOUNT_NOT_FOUND'),
      });
    }
  };

  return (
    <div className={cx(auth.page, auth.narrow, auth.tight)}>
      <Logo className={auth.mobileOnly} />

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
          {formError.noAccount && (
            <Link to={paths.beforeYouStart} state={signUpState}>
              Create an account
            </Link>
          )}
        </Alert>
      )}

      {googleSignIn.available && (
        <>
          <Button
            variant="secondary"
            fullWidth
            onClick={handleGoogle}
            disabled={pending !== null}
            aria-busy={pending === 'google' || undefined}
          >
            {pending === 'google' ? 'Connecting to Google…' : 'Continue with Google'}
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
          disabled={pending !== null}
          onChange={(event) => {
            setEmail(event.target.value);
            if (submitted) setEmailError(validateEmail(event.target.value));
          }}
        />
        <Button
          type="submit"
          fullWidth
          disabled={pending !== null}
          aria-busy={pending === 'email' || undefined}
        >
          {pending === 'email' ? 'Sending your code…' : 'Send me a code'}
        </Button>
        <p className={auth.helper}>We’ll email you a 6-digit code. No password to remember.</p>
      </form>

      <p className={auth.switch}>
        New to CareLayer?
        <Link to={paths.beforeYouStart} state={signUpState} className={auth.textLink}>
          Create an account
        </Link>
      </p>
    </div>
  );
}
