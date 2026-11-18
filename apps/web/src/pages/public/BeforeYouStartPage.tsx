import { ButtonLink } from '../../components/Button/Button';
import { ScreenPlaceholder } from '../../components/ScreenPlaceholder/ScreenPlaceholder';
import { paths } from '../../routes/paths';

/** W02 Before you start (Figma: W02 / D-W02). */
export function BeforeYouStartPage() {
  return (
    <ScreenPlaceholder
      screenId="W02"
      screenName="Before you start"
      description="Privacy and safety promises she agrees to before creating an account. Onboarding content is built in a later phase."
      header={false}
    >
      <ButtonLink to={paths.signUp}>Continue</ButtonLink>
    </ScreenPlaceholder>
  );
}
