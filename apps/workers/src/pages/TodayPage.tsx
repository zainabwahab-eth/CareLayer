import { Icon } from '@web/components/Icon/Icon';
import { useAuth } from '../auth/useAuth';
import { useReadyProfile } from '../onboarding/profile-context';
import styles from './onboarding/onboarding.module.css';
import review from './onboarding/ReviewPage.module.css';

/*
 * Where an approved nurse lands. N05 Today (dashboard, availability, cases) is
 * the rest of H9 and is not built yet; this says so plainly instead of showing
 * a half-made screen.
 */
export function TodayPage() {
  const { profile } = useReadyProfile();
  const { logout } = useAuth();
  const firstName = profile.fullName.split(' ')[0] ?? profile.fullName;
  return (
    <div className={styles.page}>
      <span className={review.badge} aria-hidden>
        <Icon name="shield" size={34} />
      </span>
      <h1 className={styles.title}>You’re verified, {firstName}</h1>
      <p className={styles.ledeLarge}>
        Your licence has been checked. The screens for answering questions are coming in the next
        update of this app.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.textButton} onClick={() => void logout()}>
          Log out
        </button>
      </div>
    </div>
  );
}
