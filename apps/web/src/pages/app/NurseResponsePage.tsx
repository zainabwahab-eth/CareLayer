import { useParams } from 'react-router';
import { ScreenPlaceholder } from '../../components/ScreenPlaceholder/ScreenPlaceholder';
import { paths } from '../../routes/paths';

/** W11 Nurse response (Figma: W11 / D-W11). */
export function NurseResponsePage() {
  const { consultationId = '' } = useParams();
  return (
    <ScreenPlaceholder
      screenId="W11"
      screenName="Nurse response"
      description={`The verified professional’s answer for consultation “${consultationId}”. Built in a later phase.`}
      topBar={{ title: 'Your nurse has replied', backTo: paths.history }}
    />
  );
}
