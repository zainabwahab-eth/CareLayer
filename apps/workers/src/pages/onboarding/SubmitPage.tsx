import { NURSE_DOCUMENT_TYPES, type OnboardingRequirement } from '@carelayer/shared';
import { loadErrorMessage } from '@web/api/error-message';
import { hasErrorCode, isApiError } from '@web/api/errors';
import { isSessionError } from '@web/auth/auth-flow';
import { Alert } from '@web/components/Alert/Alert';
import { Button } from '@web/components/Button/Button';
import { Checkbox } from '@web/components/Checkbox/Checkbox';
import { categoryLabel } from '@web/utils/categories';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useNurseApi } from '../../api/api-context';
import { useAuth } from '../../auth/useAuth';
import { StepHeader } from '../../components/StepHeader';
import {
  GENDER_OPTIONS,
  ROLE_OPTIONS,
  describeRequirement,
  readMissing,
} from '../../onboarding/onboarding';
import { useReadyProfile } from '../../onboarding/profile-context';
import { paths } from '../../routes/paths';
import styles from './onboarding.module.css';

/*
 * Step 3 of 3: check and send. No Figma frame (N02 and N03 say "of 3", N04
 * follows). Built from the design system: N04's checklist card for the summary,
 * Checkbox for the guidance agreement the API requires before submitting
 * (guidanceNotDiagnosisAccepted), Button/Primary to send.
 * PATCH /nurse/profile { guidanceNotDiagnosisAccepted } then POST /nurse/profile/submit.
 */
export function SubmitPage() {
  const api = useNurseApi();
  const { sessionExpired } = useAuth();
  const { profile, setProfile, reload } = useReadyProfile();
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(profile.guidanceNotDiagnosisAccepted);
  const [agreeError, setAgreeError] = useState<string>();
  const [missing, setMissing] = useState<OnboardingRequirement[]>([]);
  const [formError, setFormError] = useState<string>();
  const [sending, setSending] = useState(false);
  const agreeRef = useRef<HTMLInputElement>(null);

  const role = ROLE_OPTIONS.find((r) => r.value === profile.role)?.label ?? 'Not chosen';
  const gender = GENDER_OPTIONS.find((g) => g.value === profile.gender)?.label;
  const documentsDone = NURSE_DOCUMENT_TYPES.filter((t) =>
    profile.documents.some((d) => d.type === t),
  ).length;

  const handleSend = async () => {
    if (sending) return;
    setFormError(undefined);
    setMissing([]);
    if (!agreed) {
      setAgreeError('Tick this to send your application.');
      agreeRef.current?.focus();
      return;
    }
    setSending(true);
    try {
      if (!profile.guidanceNotDiagnosisAccepted) {
        setProfile(await api.nurse.updateProfile({ guidanceNotDiagnosisAccepted: true }));
      }
      const submitted = await api.nurse.submit();
      setProfile(submitted);
      navigate(paths.review, { replace: true });
    } catch (error) {
      setSending(false);
      if (isSessionError(error)) return sessionExpired();
      if (hasErrorCode(error, 'ONBOARDING_INCOMPLETE')) {
        setMissing(readMissing(isApiError(error) ? error.details : undefined));
        void reload();
        return;
      }
      if (hasErrorCode(error, 'CONFLICT')) {
        // Already verified: reloading sends her to the right screen.
        setFormError((error as Error).message);
        void reload();
        return;
      }
      setFormError(
        loadErrorMessage(error, 'We could not send your application. Please try again.'),
      );
    }
  };

  return (
    <div className={styles.page}>
      <StepHeader step={3} back={{ to: paths.documents, label: 'Back to your documents' }} />
      <h1 className={styles.title}>Check and send</h1>
      <p className={styles.lede}>
        We check your licence with the Nursing and Midwifery Council of Nigeria. It usually takes 1
        to 2 working days.
      </p>

      {formError && <Alert tone="error">{formError}</Alert>}
      {missing.length > 0 && (
        <Alert tone="error">
          A few things are still missing:
          <ul className={styles.missingList}>
            {missing.map((m) => {
              const item = describeRequirement(m);
              return (
                <li key={m}>
                  <Link to={item.path}>{item.label}</Link>
                </li>
              );
            })}
          </ul>
        </Alert>
      )}

      <dl className={styles.summary} aria-label="Your application">
        <SummaryRow label="I am a" value={role} edit={paths.licence} />
        <SummaryRow label="Name on licence" value={profile.fullName} edit={paths.licence} />
        <SummaryRow
          label="Licence number"
          value={profile.licenceNumber ?? 'Not added'}
          edit={paths.licence}
        />
        <SummaryRow
          label="Years of practice"
          value={profile.yearsOfPractice === null ? 'Not added' : String(profile.yearsOfPractice)}
          edit={paths.licence}
        />
        {gender && <SummaryRow label="Gender" value={gender} edit={paths.licence} />}
        <SummaryRow
          label="Topics"
          value={profile.topics.map(categoryLabel).join(', ') || 'None chosen'}
          edit={paths.licence}
        />
        <SummaryRow
          label="Documents"
          value={`${documentsDone} of ${NURSE_DOCUMENT_TYPES.length} uploaded`}
          edit={paths.documents}
        />
      </dl>

      <Checkbox
        ref={agreeRef}
        checked={agreed}
        error={agreeError}
        disabled={sending}
        onChange={(e) => {
          setAgreed(e.target.checked);
          if (e.target.checked) setAgreeError(undefined);
        }}
      >
        I’ll give guidance, not diagnoses, and tell women to see someone in person when they need
        to.
      </Checkbox>

      <div className={styles.actions}>
        <Button fullWidth onClick={handleSend} disabled={sending} aria-busy={sending || undefined}>
          {sending ? 'Sending…' : 'Send for review'}
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, edit }: { label: string; value: string; edit: string }) {
  return (
    <div className={styles.summaryRow}>
      <dt className={styles.summaryLabel}>{label}</dt>
      <dd className={styles.summaryValue}>{value}</dd>
      <dd>
        <Link to={edit} className={styles.summaryEdit} aria-label={`Change ${label.toLowerCase()}`}>
          Change
        </Link>
      </dd>
    </div>
  );
}
