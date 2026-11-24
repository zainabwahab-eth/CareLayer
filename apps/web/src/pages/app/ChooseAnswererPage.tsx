import {
  CHOSEN_NURSE_WINDOW_MINUTES,
  QUESTION_CLAIMS_CLOSE_MINUTES,
  type NursePublicProfile,
} from '@carelayer/shared';
import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { loadErrorMessage } from '../../api/error-message';
import { useApiQuery } from '../../api/useApiQuery';
import { draftFor, FIRST_AVAILABLE, type PreparedDraft } from '../../ask-nurse/send-flow';
import { useSendFlow } from '../../ask-nurse/useSendFlow';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { useChat } from '../../chat/useChat';
import { Alert } from '../../components/Alert/Alert';
import { Avatar } from '../../components/Avatar/Avatar';
import { Badge } from '../../components/Badge/Badge';
import { Button } from '../../components/Button/Button';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon/Icon';
import { Toggle } from '../../components/Toggle/Toggle';
import { paths } from '../../routes/paths';
import { categoryLabel } from '../../utils/categories';
import { formatNaira } from '../../utils/money';
import { FlowScreen } from './send/FlowScreen';
import styles from './send/flow.module.css';
import {
  helpfulLabel,
  languagesLabel,
  nurseExperienceLine,
  responseTimeLabel,
} from './send/labels';

/*
 * W08 Choose who answers (Figma "W08 Choose who answers").
 *
 * "First available" (default) or one approved, available nurse from
 * GET /nurses?topic=&femaleOnly= (contract §8.0). Everything shown about a
 * nurse comes from her public profile: rating as "% helpful (count)", no stars;
 * response time only once she has answered; never contact details.
 */
export function ChooseAnswererPage() {
  const chat = useChat();
  const flow = useSendFlow();
  const draft = draftFor(flow, chat.turns);
  // Already sent: go where the send went (Back from W10 lands here).
  if (flow.finished) {
    return <Navigate to={flow.finished.to} state={flow.finished.state} replace />;
  }
  // Steps are in order: no draft or no consent yet means W07 first.
  if (!draft || !flow.consented) return <Navigate to={paths.askConsent} replace />;
  return <ChooseAnswerer draft={draft} />;
}

function ChooseAnswerer({ draft: { draft, offer } }: { draft: PreparedDraft }) {
  const flow = useSendFlow();
  const navigate = useNavigate();
  const { choice, femaleOnly, choose, setFemaleOnly } = flow;
  const topic = draft.category;

  const nurses = useApiQuery(
    (api) => api.nurses.list({ topic, ...(femaleOnly ? { femaleOnly: true } : {}) }),
    [topic, femaleOnly],
  );
  useSessionGuard(nurses.error);

  // A chosen nurse who is no longer listed (now unavailable, or filtered out by
  // "Only female health workers") can't be sent to: fall back to first available.
  const chosenId = choice.kind === 'chosen_nurse' ? choice.nurse.id : null;
  useEffect(() => {
    if (chosenId && nurses.data && !nurses.data.some((n) => n.id === chosenId)) {
      choose(FIRST_AVAILABLE);
    }
  }, [chosenId, nurses.data, choose]);

  const list = nurses.data ?? [];
  const priceLine = offer.isFree
    ? 'Free: this uses one of your free answers.'
    : `${formatNaira(offer.price)}, charged only when your answer is delivered.`;

  return (
    <FlowScreen
      title="Send to a nurse"
      subtitle="Step 2 of 3"
      step={2}
      backTo={paths.askConsent}
      backLabel="Back to step 1"
      footer={
        <>
          <Toggle
            label="Only female health workers"
            checked={femaleOnly}
            onCheckedChange={setFemaleOnly}
          />
          <Button fullWidth onClick={() => navigate(paths.askConfirm)}>
            Continue
          </Button>
        </>
      }
    >
      <h2 className={styles.heading}>Who should answer?</h2>
      <AvailabilityLine status={nurses.status} count={list.length} topic={categoryLabel(topic)} />

      {nurses.status === 'error' && (
        <div className={styles.errorBlock}>
          <Alert tone="error">
            {loadErrorMessage(
              nurses.error,
              'We could not load who is available. You can still send it to the first available nurse.',
            )}
          </Alert>
          <Button variant="secondary" onClick={nurses.reload}>
            Try again
          </Button>
        </div>
      )}

      <fieldset className={styles.options}>
        <legend className="visually-hidden">Who should answer your question</legend>

        <label className={styles.option}>
          <span className={styles.optionIcon} aria-hidden>
            <Icon name="zap" size={20} />
          </span>
          <span className={styles.optionText}>
            <span className={styles.optionTitleRow}>
              <span className={cx(styles.optionTitle, styles.optionTitleLarge)}>
                First available
              </span>
              <Badge variant="primary">Fastest</Badge>
            </span>
            <span className={styles.small}>
              The first verified nurse or midwife who is free answers it. {priceLine}
            </span>
          </span>
          <input
            type="radio"
            name="answerer"
            className={styles.radio}
            checked={choice.kind === 'first_available'}
            onChange={() => choose(FIRST_AVAILABLE)}
          />
        </label>

        {list.length > 0 && <p className={styles.sectionLabel}>Or choose a nurse or midwife</p>}
        {list.map((nurse) => (
          <NurseOption
            key={nurse.id}
            nurse={nurse}
            checked={chosenId === nurse.id}
            onSelect={() => choose({ kind: 'chosen_nurse', nurse })}
          />
        ))}
      </fieldset>

      {choice.kind === 'chosen_nurse' && (
        <p className={styles.small} role="status">
          {choice.nurse.fullName} has {CHOSEN_NURSE_WINDOW_MINUTES} minutes to pick it up. After
          that, any available nurse or midwife can answer.
        </p>
      )}
    </FlowScreen>
  );
}

function AvailabilityLine({
  status,
  count,
  topic,
}: {
  status: 'loading' | 'success' | 'error';
  count: number;
  topic: string;
}) {
  if (status === 'loading') {
    return (
      <p className={styles.lead} role="status">
        Checking who is available…
      </p>
    );
  }
  if (status === 'error') return null;
  if (count === 0) {
    return (
      <p className={styles.lead} role="status">
        No one is available for {topic.toLowerCase()} questions right now. You can still send it: if
        no one picks it up within {QUESTION_CLAIMS_CLOSE_MINUTES} minutes, you pay nothing.
      </p>
    );
  }
  return (
    <p className={styles.lead} role="status">
      {count} verified {count === 1 ? 'professional is' : 'professionals are'} available for{' '}
      {topic.toLowerCase()} questions right now.
    </p>
  );
}

function NurseOption({
  nurse,
  checked,
  onSelect,
}: {
  nurse: NursePublicProfile;
  checked: boolean;
  onSelect: () => void;
}) {
  const responseTime = responseTimeLabel(nurse.avgResponseMinutes);
  return (
    <label className={styles.option}>
      <Avatar name={nurse.fullName} decorative />
      <span className={styles.optionText}>
        <span className={styles.optionTitleRow}>
          <span className={styles.optionTitle}>{nurse.fullName}</span>
          <Badge variant="verified">Verified</Badge>
        </span>
        <span className={styles.small}>{nurseExperienceLine(nurse)}</span>
        <span className={styles.meta}>
          <span className={styles.metaItem}>
            <Icon name="heart" size={14} />
            {helpfulLabel(nurse.helpful)}
          </span>
          {responseTime && (
            <span className={styles.metaItem}>
              <Icon name="clock" size={14} />
              <span className="visually-hidden">Usually answers in </span>
              {responseTime}
            </span>
          )}
          {nurse.languages.length > 0 && (
            <span className={styles.metaItem}>
              <Icon name="chat" size={14} />
              <span className="visually-hidden">Speaks </span>
              {languagesLabel(nurse.languages)}
            </span>
          )}
        </span>
      </span>
      <input
        type="radio"
        name="answerer"
        className={styles.radio}
        checked={checked}
        onChange={onSelect}
      />
    </label>
  );
}
