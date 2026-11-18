import { PageHeader } from '../../components/PageHeader/PageHeader';
import { ThemeSwitcher } from '../../components/ThemeSwitcher/ThemeSwitcher';
import styles from './AccountPage.module.css';

/**
 * Account tab. Figma has no Account screen yet, so this holds only the
 * Appearance setting (System / Light / Dark); profile, wallet and sign out
 * come in later phases.
 */
export function AccountPage() {
  return (
    <div className={styles.page}>
      <PageHeader title="Account" />
      <section className={styles.card} aria-label="Settings">
        <ThemeSwitcher />
      </section>
    </div>
  );
}
