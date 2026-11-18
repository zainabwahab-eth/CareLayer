import { ButtonLink } from '../../components/Button/Button';
import { IconButton } from '../../components/IconButton/IconButton';
import { ScreenPlaceholder } from '../../components/ScreenPlaceholder/ScreenPlaceholder';
import { consultationPath, paths } from '../../routes/paths';

/** W05 Home (Figma: W05 Home / D-W05 Home). */
export function HomePage() {
  return (
    <ScreenPlaceholder
      screenId="W05"
      screenName="Home"
      description="Ask card, active consultation and recent consultations. Built with the mock API in a later phase."
      header={{
        title: 'Home',
        actions: <IconButton icon="bell" label="Notifications" disabled />,
      }}
    >
      <ButtonLink to={paths.ask}>Ask a question</ButtonLink>
      <ButtonLink to={consultationPath('demo')} variant="secondary">
        Open a consultation
      </ButtonLink>
    </ScreenPlaceholder>
  );
}
