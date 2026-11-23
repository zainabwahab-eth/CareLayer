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
import {
  APP,
  FULL_NAME_MAX_LENGTH,
  nurseAuthErrorMessage,
  validateFullName,
} from '../../auth/nurse-auth';
import { useFocusAfterRender } from '../../hooks/useFocusAfterRender';
import { paths } from '../../routes/paths';
import { useGoogleAuth } from './useGoogleAuth';

/*
 * Figma D-N01 "Join CareLayer" form side: Continue with Google, or full name
 * (as on the licence) + email -> POST /auth/code/request (purpose "signup",
 * app "nurses") -> verify. Her name becomes her profile's fullName (contract §10).
 */
interface FieldErrors {
  name?: string;
  email?: string;
}

export function SignUpForm() {
  const api = useNurseApi();
  const google = useGoogleAuth('signup');
  const navigate = useNavigate();
  const location = useLocation();
  const entry = readEntryState(location.state);

  const [name, setName] = useState('');
  const [email, setEmail] = useState(entry.email ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<{ message: string; accountExists: boolean }>();
  const [sending, setSending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const focusLater = useFocusAfterRender();

  const busy = sending || google.pending;
  const logInState: AuthEntryState = { from: entry.from, email: email.trim() || undefined };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setFormError(undefined);
    const errors: FieldErrors = { name: validateFullName(name), email: validateEmail(email) };
    setFieldErrors(errors);
    if (errors.name) return nameRef.current?.focus();
    if (errors.email) return emailRef.current?.focus();

    const fullName = name.trim();
    const normalisedEmail = normaliseEmail(email);
    setSending(true);
    try {
      const { resendAvailableAt } = await api.auth.requestCode({
        email: normalisedEmail,
        purpose: 'signup',
        app: APP,
        name: fullName,
      });
      const next: VerifyEmailState = {
        email: normalisedEmail,
        purpose: 'signup',
        name: fullName,
        resendAvailableAt,
        from: entry.from,
      };
      navigate(paths.verifyEmail, { state: next });
    } catch (error) {
      setSending(false);
      const field = isApiError(error) ? error.details?.field : undefined;
      if (hasErrorCode(error, 'VALIDATION_FAILED') && (field === 'name' || field === 'email')) {
        setFieldErrors({ [field]: error.message });
        focusLater(() => (field === 'name' ? nameRef : emailRef).current);
        return;
      }
      setFormError({
        message: nurseAuthErrorMessage(error),
        accountExists: hasErrorCode(error, 'ACCOUNT_EXISTS'),
      });
    }
  };

  const handleGoogle = async () => {
    if (busy) return;
    setFormError(undefined);
    const { error } = await google.start(name);
    if (error) {
      setFormError({
        message: nurseAuthErrorMessage(error),
        accountExists: hasErrorCode(error, 'ACCOUNT_EXISTS'),
      });
    }
  };

  return (
    <div className={cx(auth.page, auth.narrow)}>
      <div className={auth.heading}>
        <h1 className={auth.title}>Join CareLayer</h1>
        <p className={auth.lede}>
          For registered nurses and midwives in Nigeria. Verification takes 1 to 2 working days.
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
          ref={nameRef}
          label="Full name, as on your licence"
          hint="We check it against your licence. Women see it on your answers."
          autoComplete="name"
          autoCapitalize="words"
          maxLength={FULL_NAME_MAX_LENGTH + 10}
          value={name}
          error={fieldErrors.name}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value);
            if (submitted) {
              setFieldErrors((c) => ({ ...c, name: validateFullName(event.target.value) }));
            }
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
          disabled={busy}
          onChange={(event) => {
            setEmail(event.target.value);
            if (submitted) {
              setFieldErrors((c) => ({ ...c, email: validateEmail(event.target.value) }));
            }
          }}
        />
        <Button type="submit" fullWidth disabled={busy} aria-busy={sending || undefined}>
          {sending ? 'Sending your code…' : 'Create account'}
        </Button>
        <p className={auth.helper}>We’ll email you a 6-digit code. No password needed.</p>
      </form>

      <p className={auth.switch}>
        Already joined?
        <Link to={paths.logIn} state={logInState} className={auth.textLink}>
          Log in
        </Link>
      </p>
    </div>
  );
}
