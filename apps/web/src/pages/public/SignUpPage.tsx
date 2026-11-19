import { FREE_ANSWERS_PER_WOMAN } from '@carelayer/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { hasErrorCode, isApiError } from '../../api/errors';
import { useApi } from '../../api/useApi';
import {
  APP,
  NAME_MAX_LENGTH,
  authErrorMessage,
  describeDevice,
  normaliseEmail,
  readEntryState,
  validateEmail,
  validateName,
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
 * W03 Sign up (Figma: "W03 Sign up", "— Dark", "D-W03").
 * "What should we call you?" + email -> POST /auth/code/request (purpose "signup")
 * -> W04 Verify email. Or "Continue with Google" -> POST /auth/google (mode "signup").
 */
interface FieldErrors {
  name?: string;
  email?: string;
}

type Pending = 'email' | 'google' | null;

export function SignUpPage() {
  const api = useApi();
  const { completeSignIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const entry = readEntryState(location.state);

  const [name, setName] = useState('');
  const [email, setEmail] = useState(entry.email ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<{ message: string; accountExists: boolean }>();
  const [pending, setPending] = useState<Pending>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const validate = (values = { name, email }): FieldErrors => ({
    name: validateName(values.name),
    email: validateEmail(values.email),
  });

  const logInState: AuthEntryState = { from: entry.from, email: email.trim() || undefined };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    setFormError(undefined);

    const errors = validate();
    setFieldErrors(errors);
    if (errors.name) return nameRef.current?.focus();
    if (errors.email) return emailRef.current?.focus();

    const trimmedName = name.trim();
    const normalisedEmail = normaliseEmail(email);
    setPending('email');
    try {
      const { resendAvailableAt } = await api.auth.requestCode({
        email: normalisedEmail,
        purpose: 'signup',
        app: APP,
        name: trimmedName,
      });
      const next: VerifyEmailState = {
        email: normalisedEmail,
        purpose: 'signup',
        name: trimmedName,
        resendAvailableAt,
        from: entry.from,
      };
      navigate(paths.verifyEmail, { state: next });
    } catch (error) {
      setPending(null);
      const field = isApiError(error) ? error.details?.field : undefined;
      if (hasErrorCode(error, 'VALIDATION_FAILED') && (field === 'name' || field === 'email')) {
        setFieldErrors({ [field]: error.message });
        return;
      }
      setFormError({
        message: authErrorMessage(error),
        accountExists: hasErrorCode(error, 'ACCOUNT_EXISTS'),
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
        mode: 'signup',
        app: APP,
        name: name.trim() || undefined,
        deviceName: describeDevice(),
      });
      completeSignIn(tokens); // GuestOnly then sends her on to Home.
    } catch (error) {
      setPending(null);
      setFormError({
        message: authErrorMessage(error),
        accountExists: hasErrorCode(error, 'ACCOUNT_EXISTS'),
      });
    }
  };

  return (
    <div className={cx(auth.page, auth.narrow, auth.tight)}>
      <Logo className={auth.mobileOnly} />

      <div className={auth.heading}>
        <h1 className={auth.title}>Create your account</h1>
        <p className={auth.lede}>
          Your first {FREE_ANSWERS_PER_WOMAN} answers are free. Nurses never see your name or email.
        </p>
      </div>

      {formError && (
        <Alert tone="error">
          {formError.message}{' '}
          {formError.accountExists && (
            <Link to={paths.logIn} state={logInState}>
              Log in instead
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
          ref={nameRef}
          label="What should we call you?"
          placeholder="First name or nickname"
          hint="Only you and your assistant see this."
          autoComplete="nickname"
          autoCapitalize="words"
          maxLength={NAME_MAX_LENGTH + 10}
          value={name}
          error={fieldErrors.name}
          disabled={pending !== null}
          onChange={(event) => {
            setName(event.target.value);
            if (submitted)
              setFieldErrors((current) => ({ ...current, name: validateName(event.target.value) }));
          }}
        />
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
          error={fieldErrors.email}
          disabled={pending !== null}
          onChange={(event) => {
            setEmail(event.target.value);
            if (submitted)
              setFieldErrors((current) => ({
                ...current,
                email: validateEmail(event.target.value),
              }));
          }}
        />
        <Button
          type="submit"
          fullWidth
          disabled={pending !== null}
          aria-busy={pending === 'email' || undefined}
        >
          {pending === 'email' ? 'Sending your code…' : 'Create account'}
        </Button>
        <p className={auth.helper}>We’ll email you a 6-digit code. No password to remember.</p>
      </form>

      <p className={auth.switch}>
        Already have an account?
        <Link to={paths.logIn} state={logInState} className={auth.textLink}>
          Log in
        </Link>
      </p>
    </div>
  );
}
