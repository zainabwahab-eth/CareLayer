import { ButtonLink } from '../../components/Button/Button';
import { ScreenPlaceholder } from '../../components/ScreenPlaceholder/ScreenPlaceholder';
import { paths } from '../../routes/paths';

/** W03 Sign up (Figma: W03 / D-W03). */
export function SignUpPage() {
  return (
    <ScreenPlaceholder
      screenId="W03"
      screenName="Sign up"
      description="“What should we call you?”, email, and Google sign-in. Authentication is built in a later phase."
      header={false}
    >
      <ButtonLink to={paths.verifyEmail}>Continue</ButtonLink>
    </ScreenPlaceholder>
  );
}
