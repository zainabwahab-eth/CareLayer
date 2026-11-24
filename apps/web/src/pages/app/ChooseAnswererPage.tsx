import { CHOSEN_NURSE_WINDOW_MINUTES, type NursePublicProfile } from '@carelayer/shared';
import { Navigate, useNavigate } from 'react-router';
import { useApiQuery } from '../../api/useApiQuery';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { useChat } from '../../chat/useChat';
import { Alert } from '../../components/Alert/Alert';
import { Avatar } from '../../components/Avatar/Avatar';
import { Badge } from '../../components/Badge/Badge';
import { Button } from '../../components/Button/Button';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon/Icon';
import { Toggle } from '../../components/Toggle/Toggle';
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { paths } from '../../routes/paths';
import { categoryLabel } from '../../utils/categories';
import { formatNaira } from '../../utils/money';
import { helpfulLabel, languagesLabel, nurseRoleLabel } from '../../utils/nurses';
import styles from './ChooseAnswererPage.module.css';
import { FlowHeader } from './ask/FlowHeader';
import { FlowSteps } from './ask/FlowSteps';
import { flowErrorMessage } from './ask/flow-errors';

const FIRST_AVAILABLE = 'first_available';

/**
 * W08 Choose who answers (Figma: "W08 Choose who answers", "D-W08 Choose who answers").
 * "First available" (the default) or a specific approved, available nurse from
 * GET /nurses for her question's topic. "Only female health workers" filters the
 * list and is sent with the question.
 */
export function ChooseAnswererPage() {
  const { request, setRequest } = useChat();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
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
  const topicName = categoryLabel(request.draft.category).toLowerCase();
  const availability =
    nurses.status !== 'success'
      ? undefined
      : available.length === 0
        ? `No one is available for ${topicName} questions right now. First available sends it to the next verified nurse who comes online.`
        : `${available.length} verified ${available.length === 1 ? 'nurse is' : 'nurses are'} available for ${topicName} questions right now.`;

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

  const femaleToggle = (
    <Toggle
      checked={femaleOnly}
      onCheckedChange={setFemaleOnly}
      label="Only female health workers"
      className={styles.toggle}
    />
  );
  const canContinue = nurses.status !== 'loading' && !choiceMissing;
  const next = () => navigate(paths.askConfirm);

  return (
    <div className={styles.page}>
      <FlowHeader
        title="Send to a nurse"
        subtitle="Step 2 of 3"
        desktopSubtitle={availability}
        backTo={paths.askConsent}
        backLabel="Back to what’s shared"
      />
      <FlowSteps current={2} />

      <div className={styles.titleRow}>
        <h2 className={styles.title}>Who should answer?</h2>
        {isDesktop && femaleToggle}
      </div>
      {!isDesktop && availability && <p className={styles.lead}>{availability}</p>}

      <div role="radiogroup" aria-label="Who should answer" className={styles.options}>
        <label className={cx(styles.first, selected === FIRST_AVAILABLE && styles.selected)}>
          <span className={styles.zap} aria-hidden>
            <Icon name="zap" size={isDesktop ? 24 : 20} />
          </span>
          <span className={styles.firstText}>
            <span className={styles.firstName}>
              First available
              <Badge variant="primary">{isDesktop ? 'Fastest, recommended' : 'Fastest'}</Badge>
            </span>
            <span className={styles.muted}>
              The first verified nurse or midwife free to claim it. Usually answered in under 10
              minutes.
            </span>
            {!isDesktop && <span className={styles.firstPrice}>{price}</span>}
          </span>
          {isDesktop && <span className={styles.firstPrice}>{price}</span>}
          <input
            type="radio"
            name="answerer"
            value={FIRST_AVAILABLE}
            checked={selected === FIRST_AVAILABLE}
            onChange={() => choose(FIRST_AVAILABLE)}
            className={styles.radio}
          />
        </label>

        <h3 className={styles.subhead}>Or choose a nurse</h3>

        {nurses.status === 'loading' && (
          <p className={styles.muted} role="status">
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
        {available.length > 0 && (
          <div className={styles.grid}>
            {available.map((nurse) => (
              <NurseCard
                key={nurse.id}
                nurse={nurse}
                price={price}
                checked={selected === nurse.id}
                onChoose={() => choose(nurse.id)}
                desktop={isDesktop}
              />
            ))}
          </div>
        )}
        {choiceMissing && (
          <Alert tone="info">
            The nurse you chose is not available any more. Choose someone else or First available.
          </Alert>
        )}
      </div>

      {isDesktop ? (
        <div className={styles.footer}>
          <p className={styles.note}>
            If the nurse you choose doesn’t claim it in {CHOSEN_NURSE_WINDOW_MINUTES} minutes, it
            goes to the first available.
          </p>
          <Button variant="ghost" onClick={() => navigate(paths.askConsent)}>
            Back
          </Button>
          <Button disabled={!canContinue} onClick={next}>
            Continue
          </Button>
        </div>
      ) : (
        <div className={styles.mobileFooter}>
          {femaleToggle}
          <Button fullWidth disabled={!canContinue} onClick={next}>
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}

/** Figma "Nurse / …": a card on desktop (grid of three), a row on mobile. */
function NurseCard({
  nurse,
  price,
  checked,
  onChoose,
  desktop,
}: {
  nurse: NursePublicProfile;
  price: string;
  checked: boolean;
  onChoose: () => void;
  desktop: boolean;
}) {
  const years = `${nurse.yearsOfPractice} ${nurse.yearsOfPractice === 1 ? 'year' : 'years'}`;
  const meta = (
    <span className={styles.meta}>
      <span className={styles.metaItem}>
        <Icon name="star" size={16} />
        {helpfulLabel(nurse.helpful)}
      </span>
      {nurse.avgResponseMinutes != null && (
        <span className={styles.metaItem}>
          <Icon name="clock" size={16} />~{nurse.avgResponseMinutes} min
        </span>
      )}
      {!desktop && nurse.languages.length > 0 && (
        <span className={styles.metaItem}>
          <Icon name="chat" size={16} />
          {languagesLabel(nurse.languages)}
        </span>
      )}
    </span>
  );
  const radio = (
    <input
      type="radio"
      name="answerer"
      value={nurse.id}
      checked={checked}
      onChange={onChoose}
      className={styles.radio}
      aria-label={`${nurse.fullName}, ${nurseRoleLabel(nurse.role)}`}
    />
  );

  if (!desktop) {
    return (
      <label className={cx(styles.nurse, checked && styles.selected)}>
        <Avatar name={nurse.fullName} size={44} decorative />
        <span className={styles.nurseText}>
          <span className={styles.nurseName}>
            {nurse.fullName}
            <Badge variant="verified">Verified</Badge>
          </span>
          <span className={styles.muted}>
            {nurseRoleLabel(nurse.role)}, {years}
          </span>
          {meta}
        </span>
        {radio}
      </label>
    );
  }

  return (
    <label className={cx(styles.nurseCard, checked && styles.selected)}>
      <span className={styles.cardTop}>
        <Avatar name={nurse.fullName} size={44} decorative />
        <span className={styles.nurseText}>
          <span className={styles.nurseName}>{nurse.fullName}</span>
          <span className={styles.muted}>
            {nurseRoleLabel(nurse.role)}, {years}
          </span>
        </span>
        {radio}
      </span>
      <Badge variant="verified">Licence verified</Badge>
      {nurse.bio && <span className={styles.bio}>{nurse.bio}</span>}
      {meta}
      {nurse.languages.length > 0 && (
        <span className={styles.metaItem}>
          <Icon name="chat" size={16} />
          {languagesLabel(nurse.languages)}
        </span>
      )}
      <span className={styles.priceRow}>
        <span className={styles.muted}>Answer price</span>
        <span className={styles.priceValue}>{price}</span>
      </span>
    </label>
  );
}
