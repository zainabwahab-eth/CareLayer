import { DEFAULT_ANSWER_PRICE_KOBO, PAYOUT_SPLIT } from '@carelayer/shared';
import { Alert } from '@web/components/Alert/Alert';
import { Button, ButtonLink } from '@web/components/Button/Button';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import { formatNaira } from '@web/utils/money';
import { useEffect, useId, useState } from 'react';
import { useNurseApi } from '../../api/api-context';
import { useAuth } from '../../auth/useAuth';
import { useReadyProfile } from '../../onboarding/profile-context';
import { paths } from '../../routes/paths';
import styles from './onboarding.module.css';
import review from './ReviewPage.module.css';

type StepState = 'done' | 'active' | 'waiting';

/*
 * N04 Under review (Figma "N04 Under review", "D-N04"), and the rejected state
 * (no frame: the reason from the admin and a way back into the steps).
 *
 * The API has one status for the whole review (pending_review), not one per
 * checklist row, so the rows are fixed while she waits (docs/QUESTIONS.md, H9).
 * GET /nurse/profile is fetched again whenever she comes back to the tab, so an
 * approval or rejection shows without a reload.
 */
export function ReviewPage() {
  const { profile, reload } = useReadyProfile();
  const { logout } = useAuth();
  const api = useNurseApi();

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  if (profile.verificationStatus === 'rejected') {
    return (
      <div className={styles.page}>
        <span className={cx(review.badge, review.badgeRejected)} aria-hidden>
          <Icon name="alert" size={32} />
        </span>
        <h1 className={styles.title}>We couldn’t verify your licence yet</h1>
        <p className={styles.ledeLarge}>
          Fix what our verification team asked for, then send your application again.
        </p>
        <Alert tone="error">
          <strong>What to fix: </strong>
          {profile.rejectionReason ?? 'Contact us so we can tell you what to change.'}
        </Alert>
        <div className={styles.actions}>
          <ButtonLink to={paths.licence} fullWidth>
            Fix and send again
          </ButtonLink>
          <button type="button" className={styles.textButton} onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </div>
    );
  }

  const steps: ReadonlyArray<{ label: string; state: StepState }> = [
    { label: 'Details and documents received', state: 'done' },
    { label: 'Licence checked with the council', state: 'active' },
    { label: 'Identity matched to your selfie', state: 'waiting' },
    { label: 'Ready to answer', state: 'waiting' },
  ];

  return (
    <div className={cx(styles.page, review.page)}>
      <span className={review.badge} aria-hidden>
        <Icon name="shield" size={34} />
      </span>
      <h1 className={styles.title}>We’re checking your licence</h1>
      <p className={styles.ledeLarge}>
        Usually 1 to 2 working days. We’ll email you the moment you can start answering.
      </p>

      <ol className={review.checklist} aria-label="Review progress">
        {steps.map((step) => (
          <li key={step.label} className={review.row}>
            <span className={cx(review.dot, review[step.state])} aria-hidden>
              {step.state === 'done' && <Icon name="check" size={14} />}
            </span>
            <span className={cx(review.rowLabel, step.state === 'waiting' && review.muted)}>
              {step.label}
            </span>
            <span className={review.rowState}>
              {step.state === 'done' ? 'Done' : step.state === 'active' ? 'In progress' : 'Waiting'}
            </span>
          </li>
        ))}
      </ol>

      <div className={styles.actions}>
        <HowAnsweringWorks />
        <button type="button" className={styles.textButton} onClick={() => void logout()}>
          Log out
        </button>
        {api.mockAdmin && <MockReviewControls />}
      </div>
    </div>
  );
}

/** Figma "Preview how answering works": a short explainer (no frame for its content). */
function HowAnsweringWorks() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // ₦400: the nurse's 80% of the agreed ₦500 price (docs/TASKS.md §2).
  const nurseShareKobo = (DEFAULT_ANSWER_PRICE_KOBO * PAYOUT_SPLIT.nurseBps) / 10_000;
  return (
    <div className={review.preview}>
      <Button
        variant="secondary"
        fullWidth
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide how answering works' : 'Preview how answering works'}
      </Button>
      {open && (
        <ol id={panelId} className={review.howList}>
          <li>
            When a question matches your topics, we email you. The email names the topic only, never
            the question.
          </li>
          <li>
            Claim a question to keep it for 10 minutes while you write. Release it if you can’t
            answer, so another nurse can.
          </li>
          <li>
            Answer in plain words. Give guidance, not a diagnosis, and tick “Recommend she sees
            someone today” when she should.
          </li>
          <li>
            You get {formatNaira(nurseShareKobo)} in USDC for each answer, the moment it reaches
            her. She never sees your email or phone number.
          </li>
        </ol>
      )}
    </div>
  );
}

/** Mock builds only: stand in for the admin console so the next states can be tried. */
function MockReviewControls() {
  const api = useNurseApi();
  const { reload } = useReadyProfile();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={review.mock} role="group" aria-label="Mock admin (mock API only)">
      <p className={review.mockTitle}>Mock API only: act as the admin</p>
      <div className={review.mockActions}>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void act(() => api.mockAdmin!.approve())}
        >
          Approve
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void act(() =>
              api.mockAdmin!.reject(
                'The licence number does not match the name on your practising licence. Check both and send again.',
              ),
            )
          }
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
