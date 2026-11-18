import { ButtonLink } from '../components/Button/Button';
import { PageHeader } from '../components/PageHeader/PageHeader';
import { paths } from '../routes/paths';
import styles from './NotFoundPage.module.css';

export function NotFoundPage() {
  return (
    <div className={styles.page}>
      <PageHeader title="Page not found" />
      <p className="t-body-l t-muted">This page doesn’t exist or has moved.</p>
      <div>
        <ButtonLink to={paths.home}>Back to CareLayer</ButtonLink>
      </div>
    </div>
  );
}
