import { ButtonLink } from '../../components/Button/Button';
import { ScreenPlaceholder } from '../../components/ScreenPlaceholder/ScreenPlaceholder';
import { paths } from '../../routes/paths';

/** W01 Welcome (Figma: W01 Welcome / D-W01 Welcome). */
export function WelcomePage() {
  return (
    <ScreenPlaceholder
      screenId="W01"
      screenName="Welcome"
      description="Landing screen: illustration, value proposition, and the start / log in actions. Full design in a later phase."
      header={false}
    >
      <ButtonLink to={paths.beforeYouStart}>Get started</ButtonLink>
      <ButtonLink to={paths.emergency} variant="ghost">
        Emergency help
      </ButtonLink>
    </ScreenPlaceholder>
  );
}
