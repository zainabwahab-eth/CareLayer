import { DESKTOP_QUERY, useMediaQuery } from '@web/hooks/useMediaQuery';
import { Alert } from '@web/components/Alert/Alert';
import { Button, ButtonLink } from '@web/components/Button/Button';
import { Icon } from '@web/components/Icon/Icon';
import type { IconName } from '@web/components/Icon/icons';
import { Logo } from '@web/components/Logo/Logo';
import { useState } from 'react';
import { Link } from 'react-router';
import { nurseAuthErrorMessage } from '../../auth/nurse-auth';
import { NurseAuthLayout } from '../../layouts/NurseAuthLayout';
import { paths } from '../../routes/paths';
import styles from './JoinPage.module.css';
import { SignUpForm } from './SignUpForm';
import { useGoogleAuth } from './useGoogleAuth';

const benefits: ReadonlyArray<{ icon: IconName; text: string }> = [
  { icon: 'clock', text: 'Answer when you’re free, between shifts' },
  { icon: 'wallet', text: '₦400 per answer, paid instantly' },
  { icon: 'heart', text: 'Help women who have nowhere else to ask' },
];

/*
 * N01 Join (Figma "N01 Join", "D-N01 Join").
 *   Mobile: the full-screen teal welcome; "Sign up with email" opens the form.
 *   Desktop: the nurse auth panel with the sign-up form beside it.
 * One or the other is rendered (not both hidden with CSS), so there is one <main>.
 */
export function JoinPage() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (desktop) {
    return (
      <NurseAuthLayout>
        <SignUpForm />
      </NurseAuthLayout>
    );
  }
  return <JoinHero />;
}

function JoinHero() {
  const google = useGoogleAuth('signup');
  const [error, setError] = useState<string>();

  const handleGoogle = async () => {
    if (google.pending) return;
    setError(undefined);
    const result = await google.start();
    if (result.error) setError(nurseAuthErrorMessage(result.error));
  };

  return (
    <main id="main-content" tabIndex={-1} className={styles.hero}>
      <Logo tone="inverse" />
      <div className={styles.copy}>
        <h1 className={styles.title}>Your expertise, on your own time.</h1>
        <p className={styles.lede}>
          Answer women’s health questions from AI assistants across Nigeria. Get paid in USDC for
          every answer, the moment it’s delivered.
        </p>
        <ul role="list" className={styles.benefits}>
          {benefits.map((benefit) => (
            <li key={benefit.text} className={styles.benefit}>
              <Icon name={benefit.icon} size={22} className={styles.benefitIcon} />
              {benefit.text}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.actions}>
        {error && <Alert tone="error">{error}</Alert>}
        {google.available && (
          <Button
            variant="secondary"
            tone="inverse"
            fullWidth
            onClick={handleGoogle}
            disabled={google.pending}
            aria-busy={google.pending || undefined}
          >
            {google.pending ? 'Connecting to Google…' : 'Continue with Google'}
          </Button>
        )}
        <ButtonLink
          to={paths.signUp}
          variant={google.available ? 'ghost' : 'secondary'}
          tone="inverse"
          fullWidth
        >
          Sign up with email
        </ButtonLink>
        {/* Not in the mobile frame; D-N01 has it and returning nurses need a way in. */}
        <p className={styles.switch}>
          Already joined?{' '}
          <Link to={paths.logIn} className={styles.switchLink}>
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
