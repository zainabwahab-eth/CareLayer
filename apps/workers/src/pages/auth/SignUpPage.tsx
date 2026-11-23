import { NurseAuthLayout } from '../../layouts/NurseAuthLayout';
import { BackLink } from '@web/components/BackLink/BackLink';
import { paths } from '../../routes/paths';
import { SignUpForm } from './SignUpForm';
import styles from './SignUpPage.module.css';

/** N01's form on its own route: "Sign up with email" on phones (desktop N01 shows it already). */
export function SignUpPage() {
  return (
    <NurseAuthLayout>
      <BackLink to={paths.join} label="Back" className={styles.back} />
      <SignUpForm />
    </NurseAuthLayout>
  );
}
