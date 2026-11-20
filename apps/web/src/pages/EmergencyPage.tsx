import type { EmergencyContact } from '@carelayer/shared';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useApiQuery } from '../api/useApiQuery';
import { useAuth } from '../auth/useAuth';
import { readEmergencyState, safeExternalUrl, telHref } from '../chat/emergency-state';
import { Alert } from '../components/Alert/Alert';
import { Button, ButtonAnchor, ButtonLink } from '../components/Button/Button';
import { cx } from '../components/cx';
import { Icon } from '../components/Icon/Icon';
import { Logo } from '../components/Logo/Logo';
import { QuickExitButton } from '../components/QuickExit/QuickExitButton';
import { paths } from '../routes/paths';
import styles from './EmergencyPage.module.css';

/*
 * W13 Emergency (Figma: "W13 Emergency", "D-W13 Emergency").
 *
 * Public on purpose: emergencies are never queued, charged or behind sign-in.
 * From the chat, the EmergencyResponse arrives in router state and shows
 * instantly. Opened directly, it loads GET /emergency (public).
 * Contacts and the hospital link always come from the API, never from here.
 *
 * Only a number the API marks `verified: true` can be the main red "Call"
 * button. Unverified numbers (e.g. mock data) are listed after the hospital
 * link, visibly tagged "Not verified", so they can never pass for checked
 * production numbers. With no verified number, the hospital link is the main action.
 */
export function EmergencyPage() {
  const location = useLocation();
  const { state: auth } = useAuth();
  const fromChat = readEmergencyState(location.state);
  const query = useApiQuery(
    (api) => (fromChat ? Promise.resolve(fromChat) : api.emergency.get()),
    [],
  );
  const emergency = fromChat ?? query.data;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the heading so screen readers announce it first.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const callable = (emergency?.contacts ?? []).flatMap((contact) => {
    const href = telHref(contact.number);
    return href ? [{ ...contact, href }] : [];
  });
  const [primary, ...otherVerified] = callable.filter((contact) => contact.verified);
  const unverified = callable.filter((contact) => !contact.verified);
  const hospitalUrl = emergency ? safeExternalUrl(emergency.findHospitalUrl) : undefined;
  const signedIn = auth.status === 'authenticated';

  return (
    <main id="main-content" tabIndex={-1} className={styles.page}>
      <div className={styles.topBar}>
        <span className={styles.desktopOnly}>
          <Logo />
        </span>
        <p className={cx(styles.topNote, styles.desktopOnly)}>
          <Icon name="lock" size={16} />
          Nothing was sent to anyone and you were not charged.
        </p>
        <QuickExitButton />
      </div>

      <div className={styles.centre}>
        <div className={styles.column}>
          <span className={styles.alertCircle} aria-hidden>
            <span className={styles.mobileOnly}>
              <Icon name="alert" size={32} />
            </span>
            <span className={styles.desktopOnly}>
              <Icon name="alert" size={36} />
            </span>
          </span>

          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            This may be an emergency. Please get help now.
          </h1>

          {emergency ? (
            <p className={styles.message}>{emergency.message}</p>
          ) : query.status === 'error' ? (
            <Alert tone="error">
              We could not load emergency numbers. Go to the nearest hospital or call your local
              emergency number now.
            </Alert>
          ) : (
            <p className={styles.message} role="status">
              Loading emergency numbers…
            </p>
          )}

          {emergency ? (
            <>
              <div className={styles.actions}>
                {primary && <ContactButton contact={primary} variant="emergency" />}
                {otherVerified.map((contact) => (
                  <ContactButton
                    key={`${contact.number}-${contact.label}`}
                    contact={contact}
                    variant="secondary"
                  />
                ))}
                {hospitalUrl && (
                  <ButtonAnchor
                    href={hospitalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant={primary ? 'secondary' : 'emergency'}
                    className={styles.action}
                  >
                    Find the nearest hospital
                    <span className="visually-hidden"> (opens a map in a new tab)</span>
                  </ButtonAnchor>
                )}
              </div>
              {unverified.length > 0 && (
                <div className={styles.unverified}>
                  <div className={styles.actions}>
                    {unverified.map((contact) => (
                      <ContactButton
                        key={`${contact.number}-${contact.label}`}
                        contact={contact}
                        variant="secondary"
                      />
                    ))}
                  </div>
                  <p className={styles.unverifiedNote}>
                    Numbers marked “Not verified” have not been checked by CareLayer yet. If a call
                    does not connect, go to the nearest hospital.
                  </p>
                </div>
              )}
            </>
          ) : (
            query.status === 'error' && (
              <Button variant="secondary" onClick={query.reload} className={styles.retry}>
                Try loading again
              </Button>
            )
          )}

          <div className={styles.whileCard}>
            <p className={styles.whileTitle}>While you get help</p>
            <p className={styles.whileBody}>
              Ask someone to stay with you if you can. Don’t wait for an answer here.
            </p>
          </div>

          <p className={cx(styles.note, styles.mobileOnly)}>
            Nothing was sent to anyone and you were not charged.
          </p>

          <div className={styles.spacer} />

          <ButtonLink
            to={signedIn ? paths.ask : paths.welcome}
            variant="ghost"
            className={styles.back}
          >
            {signedIn ? 'I’m safe, back to chat' : 'I’m safe, back to CareLayer'}
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}

function ContactButton({
  contact,
  variant,
}: {
  contact: EmergencyContact & { href: string };
  variant: 'emergency' | 'secondary';
}) {
  return (
    <ButtonAnchor href={contact.href} variant={variant} className={styles.action}>
      <span className={styles.contactText}>
        <span className={styles.contactLine}>
          Call {contact.number}
          {!contact.verified && <span className={styles.unverifiedTag}>Not verified</span>}
        </span>
        <span className={styles.contactLabel}>{contact.label}</span>
      </span>
    </ButtonAnchor>
  );
}
