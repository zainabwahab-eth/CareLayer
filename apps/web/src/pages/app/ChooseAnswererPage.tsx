import { ButtonLink } from '../../components/Button/Button';
import { ScreenPlaceholder } from '../../components/ScreenPlaceholder/ScreenPlaceholder';
import { paths } from '../../routes/paths';

/** W08 Choose who answers (Figma: W08 / D-W08). */
export function ChooseAnswererPage() {
  return (
    <ScreenPlaceholder
      screenId="W08"
      screenName="Choose who answers"
      description="Pick the first available verified professional or a specific one. Nurse selection is built in a later phase."
      topBar={{ title: 'Send to a nurse', subtitle: 'Step 2 of 3', backTo: paths.askConsent }}
    >
      <ButtonLink to={paths.askConfirm}>Continue</ButtonLink>
    </ScreenPlaceholder>
  );
}
