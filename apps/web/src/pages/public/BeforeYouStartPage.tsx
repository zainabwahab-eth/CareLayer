import { useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { readEntryState, type AuthEntryState } from '../../auth/auth-flow';
import { BackLink } from '../../components/BackLink/BackLink';
import { Button } from '../../components/Button/Button';
import { Checkbox } from '../../components/Checkbox/Checkbox';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/icons';
import { paths } from '../../routes/paths';
import auth from './auth.module.css';
import styles from './BeforeYouStartPage.module.css';

/*
 * W02 Before you start (Figma: "W02 Before you start", "— Dark", "D-W02").
 *   Mobile: promises as a list, agreement + button pinned to the bottom.
 *   Desktop: promises as a 2 x 2 grid of cards, with shorter copy.
 * She has to tick the agreement before going on to W03 Sign up.
 */
type Tone = 'primary' | 'verified' | 'emergency' | 'accent';

const promises: ReadonlyArray<{
  icon: IconName;
  tone: Tone;
  title: string;
  text: string;
  /** D-W02 uses shorter copy in the cards. */
  shortText: string;
}> = [
  {
    icon: 'lock',
    tone: 'primary',
    title: 'Anonymous by default',
    text: 'Nurses see your question, never your name, number or location.',
    shortText: 'Nurses see your question, never your name, number or location.',
  },
  {
    icon: 'shield',
    tone: 'verified',
    title: 'Verified professionals only',
    text: 'Every nurse and midwife is checked against the Nursing and Midwifery Council of Nigeria.',
    shortText: 'Checked against the Nursing and Midwifery Council of Nigeria.',
  },
  {
    icon: 'alert',
    tone: 'emergency',
    title: 'Emergencies never wait',
    text: 'If something sounds urgent, we show you where to get help straight away, free.',
    shortText: 'Urgent symptoms go straight to help, free.',
  },
  {
    icon: 'eyeOff',
    tone: 'accent',
    title: 'Quick exit, always',
    text: 'One tap hides CareLayer if someone is looking over your shoulder.',
    shortText: 'One tap or Esc twice hides CareLayer.',
  },
];

export function BeforeYouStartPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const entry = readEntryState(location.state);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string>();
  const checkboxRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!agreed) {
      setError('Tick the box to show you understand, then continue.');
      checkboxRef.current?.focus();
      return;
    }
    const next: AuthEntryState = { from: entry.from, email: entry.email };
    navigate(paths.signUp, { state: next });
  };

  return (
    <div className={auth.page}>
      <BackLink to={paths.welcome} label="Back to welcome" />

      <div className={auth.heading}>
        <h1 className={auth.title}>Before you start</h1>
        <p className={auth.lede}>Four promises we keep every time you ask.</p>
      </div>

      <ul role="list" className={styles.promises}>
        {promises.map((promise) => (
          <li key={promise.title} className={styles.promise}>
            <span className={cx(styles.iconCircle, styles[promise.tone])} aria-hidden>
              <Icon name={promise.icon} size={22} />
            </span>
            <div className={styles.text}>
              <h2 className={styles.promiseTitle}>{promise.title}</h2>
              <p className={styles.promiseBody}>
                <span className={styles.longText}>{promise.text}</span>
                <span className={styles.shortText}>{promise.shortText}</span>
              </p>
            </div>
          </li>
        ))}
      </ul>

      <form className={styles.agreementForm} onSubmit={handleSubmit} noValidate>
        <Checkbox
          ref={checkboxRef}
          className={styles.agreement}
          checked={agreed}
          error={error}
          onChange={(event) => {
            setAgreed(event.target.checked);
            if (event.target.checked) setError(undefined);
          }}
        >
          I understand CareLayer gives health guidance, not a diagnosis.
        </Checkbox>
        <Button type="submit" fullWidth>
          I understand, continue
        </Button>
      </form>
    </div>
  );
}
