import type { NursePublicProfile } from '@carelayer/shared';
import { Navigate, useNavigate } from 'react-router';
import { useApiQuery } from '../../api/useApiQuery';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { useChat } from '../../chat/useChat';
import { Alert } from '../../components/Alert/Alert';
import { Avatar } from '../../components/Avatar/Avatar';
import { Badge } from '../../components/Badge/Badge';
import { Button } from '../../components/Button/Button';
import { Toggle } from '../../components/Toggle/Toggle';
import { paths } from '../../routes/paths';
import { categoryLabel } from '../../utils/categories';
import { formatNaira } from '../../utils/money';
import { helpfulLabel, languagesLabel, nurseRoleLabel } from '../../utils/nurses';
import styles from './ask/AskFlow.module.css';
import { FlowHeader } from './ask/FlowHeader';
import { flowErrorMessage } from './ask/flow-errors';

const FIRST_AVAILABLE = 'first_available';

/**
 * W08 Choose who answers (Figma: W08 / D-W08). "First available" (the default) or a
 * specific approved, available nurse from GET /nurses for her question's topic.
 * "Only female health workers" filters the list and is sent with the question.
 */
export function ChooseAnswererPage() {
  const { request, setRequest } = useChat();
  const navigate = useNavigate();
  const topic = request?.draft.category;
  const femaleOnly = request?.femaleOnly ?? false;
  const nurses = useApiQuery(
    (api) => (topic ? api.nurses.list({ topic, femaleOnly }) : Promise.resolve([])),
    [topic, femaleOnly],
  );
  useSessionGuard(nurses.error);

  // W07 first: no consent, no question.
  if (!request?.consented) return <Navigate to={paths.askConsent} replace />;

  const { offer } = request;
  const price = offer.isFree ? 'Free' : formatNaira(offer.price);
  const selected =
    request.nurseSelection === 'chosen_nurse' && request.chosenNurse
      ? request.chosenNurse.id
      : FIRST_AVAILABLE;
  const available = nurses.data ?? [];

  const choose = (value: string) => {
    const nurse = available.find((n) => n.id === value) ?? null;
    setRequest((current) =>
      current
        ? {
            ...current,
            nurseSelection: nurse ? 'chosen_nurse' : 'first_available',
            chosenNurse: nurse,
          }
        : current,
    );
  };

  const setFemaleOnly = (checked: boolean) => {
    setRequest((current) => {
      if (!current) return current;
      // A chosen man is no longer a valid choice once she asks for women only.
      const keepChoice = !checked || current.chosenNurse?.gender === 'female';
      return {
        ...current,
        femaleOnly: checked,
        nurseSelection: keepChoice ? current.nurseSelection : 'first_available',
        chosenNurse: keepChoice ? current.chosenNurse : null,
      };
    });
  };

  // The list may have changed since she chose (she went offline, filter changed).
  const choiceMissing =
    nurses.status === 'success' &&
    selected !== FIRST_AVAILABLE &&
    !available.some((n) => n.id === selected);

  return (
    <div className={styles.page}>
      <FlowHeader title="Send to a nurse" subtitle="Step 2 of 3" backTo={paths.askConsent} />

      <div className={styles.heading}>
        <h2 className={styles.title}>Who should answer?</h2>
        {nurses.status === 'success' && (
          <p className={styles.lead}>
            {available.length === 0
              ? `No one is available for ${categoryLabel(request.draft.category).toLowerCase()} questions right now. First available sends it to the next verified nurse who comes online.`
              : `${available.length} verified ${available.length === 1 ? 'nurse is' : 'nurses are'} available for ${categoryLabel(request.draft.category).toLowerCase()} questions right now.`}
          </p>
        )}
      </div>

      <fieldset className={styles.choices}>
        <legend className="visually-hidden">Who should answer</legend>
        <label className={styles.choice}>
          <input
            type="radio"
            name="answerer"
            value={FIRST_AVAILABLE}
            checked={selected === FIRST_AVAILABLE}
            onChange={() => choose(FIRST_AVAILABLE)}
            className={styles.radio}
          />
          <span className={styles.choiceBody}>
            <span className={styles.choiceTop}>
              <span className={styles.choiceName}>First available</span>
              <Badge variant="primary">Fastest</Badge>
              <span className={styles.price}>{price}</span>
            </span>
            <span className={styles.small}>
              The first verified nurse or midwife free to answer.
            </span>
          </span>
        </label>
      </fieldset>

      <Toggle
        checked={femaleOnly}
        onCheckedChange={setFemaleOnly}
        label="Only female health workers"
        description="Only women nurses and midwives will see your question."
      />

      <section className={styles.choices} aria-labelledby="choose-nurse">
        <h3 id="choose-nurse" className={styles.sectionTitle}>
          Or choose a nurse
        </h3>
        {nurses.status === 'loading' && (
          <p className={styles.message} role="status">
            Loading nurses…
          </p>
        )}
        {nurses.status === 'error' && (
          <div className={styles.errorBlock}>
            <Alert tone="error">
              {flowErrorMessage(nurses.error, 'We could not load the nurses. Please try again.')}
            </Alert>
            <Button variant="secondary" onClick={nurses.reload}>
              Try again
            </Button>
          </div>
        )}
        {available.map((nurse) => (
          <NurseChoice
            key={nurse.id}
            nurse={nurse}
            price={price}
            checked={selected === nurse.id}
            onChoose={() => choose(nurse.id)}
          />
        ))}
        {choiceMissing && (
          <Alert tone="info">
            The nurse you chose is not available any more. Choose someone else or First available.
          </Alert>
        )}
      </section>

      <div className={styles.actions}>
        <Button
          fullWidth
          disabled={nurses.status === 'loading' || choiceMissing}
          onClick={() => navigate(paths.askConfirm)}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

function NurseChoice({
  nurse,
  price,
  checked,
  onChoose,
}: {
  nurse: NursePublicProfile;
  price: string;
  checked: boolean;
  onChoose: () => void;
}) {
  return (
    <label className={styles.choice}>
      <input
        type="radio"
        name="answerer"
        value={nurse.id}
        checked={checked}
        onChange={onChoose}
        className={styles.radio}
      />
      <Avatar name={nurse.fullName} size={40} decorative />
      <span className={styles.choiceBody}>
        <span className={styles.choiceTop}>
          <span className={styles.choiceName}>{nurse.fullName}</span>
          <Badge variant="verified">Verified</Badge>
          <span className={styles.price}>{price}</span>
        </span>
        <span className={styles.small}>
          {nurseRoleLabel(nurse.role)} · {nurse.yearsOfPractice}{' '}
          {nurse.yearsOfPractice === 1 ? 'year' : 'years'}
        </span>
        <span className={styles.small}>
          {helpfulLabel(nurse.helpful)}
          {nurse.avgResponseMinutes != null && ` · usually ~${nurse.avgResponseMinutes} min`}
          {nurse.languages.length > 0 && ` · ${languagesLabel(nurse.languages)}`}
        </span>
      </span>
    </label>
  );
}
