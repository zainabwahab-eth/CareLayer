import { useParams } from 'react-router';
import { ButtonLink } from '../../components/Button/Button';
import { ScreenPlaceholder } from '../../components/ScreenPlaceholder/ScreenPlaceholder';
import { consultationPath, paths } from '../../routes/paths';

/** W10 Waiting (Figma: W10 / D-W10). */
export function WaitingPage() {
  const { consultationId = '' } = useParams();
  return (
    <ScreenPlaceholder
      screenId="W10"
      screenName="Waiting"
      description="A verified professional is reviewing her question. Live status is built in a later phase."
      topBar={{ title: 'Waiting for a nurse', backTo: paths.history }}
    >
      <ButtonLink to={consultationPath(consultationId)}>See the reply</ButtonLink>
    </ScreenPlaceholder>
  );
}
