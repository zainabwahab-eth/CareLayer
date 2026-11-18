import { ButtonLink } from '../../components/Button/Button';
import { ScreenPlaceholder } from '../../components/ScreenPlaceholder/ScreenPlaceholder';
import { paths } from '../../routes/paths';

/** W04 Verify email (Figma: W04 / D-W04). */
export function VerifyEmailPage() {
  return (
    <ScreenPlaceholder
      screenId="W04"
      screenName="Verify email"
      description="Email code entry. Built with authentication in a later phase."
      header={false}
    >
      <ButtonLink to={paths.home}>Continue</ButtonLink>
    </ScreenPlaceholder>
  );
}
