import { ButtonLink } from '../../components/Button/Button';
import { ScreenPlaceholder } from '../../components/ScreenPlaceholder/ScreenPlaceholder';
import { consultationWaitingPath, paths } from '../../routes/paths';

/** W09 Confirm and pay (Figma: W09 / D-W09). */
export function ConfirmPayPage() {
  return (
    <ScreenPlaceholder
      screenId="W09"
      screenName="Confirm and pay"
      description="Price, balance and an explicit “Confirm and send”. Payment is built in a later phase."
      topBar={{ title: 'Send to a nurse', subtitle: 'Step 3 of 3', backTo: paths.askChoose }}
    >
      <ButtonLink to={consultationWaitingPath('demo')}>Continue</ButtonLink>
    </ScreenPlaceholder>
  );
}
