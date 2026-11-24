import { loadErrorMessage } from '../../../api/error-message';
import { hasErrorCode } from '../../../api/errors';
import { Alert } from '../../../components/Alert/Alert';
import { Button, ButtonLink } from '../../../components/Button/Button';
import { paths } from '../../../routes/paths';
import { FlowScreen } from './FlowScreen';
import styles from './flow.module.css';

/** W10/W11 when her question can't be loaded: not hers or gone (404), or a failed request. */
export function QuestionLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const notFound = hasErrorCode(error, 'NOT_FOUND');
  return (
    <FlowScreen title="Consultation" backTo={paths.history} backLabel="Back to history">
      <h2 className={styles.heading}>
        {notFound ? 'We couldn’t find this question' : 'This question didn’t load'}
      </h2>
      <div className={styles.errorBlock}>
        <Alert tone="error">
          {notFound
            ? 'It may have been opened from an old link. Your questions are all in History.'
            : loadErrorMessage(error, 'Something went wrong. Please try again.')}
        </Alert>
        <div className={styles.actionsRow}>
          {!notFound && <Button onClick={onRetry}>Try again</Button>}
          <ButtonLink to={paths.history} variant={notFound ? 'primary' : 'secondary'}>
            Go to History
          </ButtonLink>
        </div>
      </div>
    </FlowScreen>
  );
}

export function QuestionLoading() {
  return (
    <FlowScreen title="Consultation" backTo={paths.history} backLabel="Back to history">
      <div className={styles.loading} role="status">
        <p className={styles.lead}>Loading your question…</p>
      </div>
    </FlowScreen>
  );
}
