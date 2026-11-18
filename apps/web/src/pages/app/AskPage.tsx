import { ButtonLink } from '../../components/Button/Button';
import { ScreenPlaceholder } from '../../components/ScreenPlaceholder/ScreenPlaceholder';
import { paths } from '../../routes/paths';

/** W06 Assistant chat (Figma: W06 / D-W06). */
export function AskPage() {
  return (
    <ScreenPlaceholder
      screenId="W06"
      screenName="Assistant chat"
      description="Free AI assistant chat with composer and escalation suggestion. Chat is built in a later phase."
      topBar={{ title: 'Assistant', subtitle: 'Private and free', backTo: paths.home }}
    >
      <ButtonLink to={paths.askConsent}>Ask a health worker</ButtonLink>
    </ScreenPlaceholder>
  );
}
