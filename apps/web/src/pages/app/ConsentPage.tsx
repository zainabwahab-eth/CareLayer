import { Navigate } from 'react-router';
import { useChat } from '../../chat/useChat';
import { ButtonLink } from '../../components/Button/Button';
import { ScreenPlaceholder } from '../../components/ScreenPlaceholder/ScreenPlaceholder';
import { paths } from '../../routes/paths';

/** W07 Consent (Figma: W07 / D-W07). */
export function ConsentPage() {
  const { canAskNurse } = useChat();
  // Nothing to consent to without her question (e.g. opened directly, or after a reload:
  // the chat lives in memory only). Send her back to the chat to ask it first.
  if (!canAskNurse) return <Navigate to={paths.ask} replace />;

  return (
    <ScreenPlaceholder
      screenId="W07"
      screenName="Consent"
      description="She sees exactly what a nurse will receive, and nothing leaves without her tap. Built in a later phase."
      topBar={{ title: 'Send to a nurse', subtitle: 'Step 1 of 3', backTo: paths.ask }}
    >
      <ButtonLink to={paths.askChoose}>Continue</ButtonLink>
    </ScreenPlaceholder>
  );
}
