import { ButtonLink } from '@web/components/Button/Button';
import styles from './onboarding/onboarding.module.css';
import { paths } from '../routes/paths';

export function NotFoundPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Page not found</h1>
      <p className={styles.lede}>This page doesn’t exist or has moved.</p>
      <div className={styles.actions}>
        <ButtonLink to={paths.start}>Go to CareLayer</ButtonLink>
      </div>
    </div>
  );
}
