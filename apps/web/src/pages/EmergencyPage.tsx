import { Button } from '../components/Button/Button';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder/ScreenPlaceholder';

/**
 * W13 Emergency (Figma: W13 / D-W13).
 * Public on purpose: emergencies are never queued, charged or behind sign-in.
 */
export function EmergencyPage() {
  return (
    <ScreenPlaceholder
      screenId="W13"
      screenName="Emergency"
      description="Shown first when red-flag symptoms are detected. Free, never queued. Call actions and nearby help are built in a later phase."
      header={{ title: 'Emergency' }}
    >
      <Button variant="emergency" disabled>
        Call 112
      </Button>
    </ScreenPlaceholder>
  );
}
