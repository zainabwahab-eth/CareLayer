import {
  DEFAULT_TOPICS_BY_ROLE,
  QUESTION_CATEGORIES,
  type NurseProfile,
  type QuestionCategory,
  type UpdateNurseProfileBody,
} from '@carelayer/shared';
import { loadErrorMessage } from '@web/api/error-message';
import { hasErrorCode, isApiError } from '@web/api/errors';
import { isSessionError } from '@web/auth/auth-flow';
import { Alert } from '@web/components/Alert/Alert';
import { Button } from '@web/components/Button/Button';
import { Checkbox } from '@web/components/Checkbox/Checkbox';
import { Chip } from '@web/components/Chip/Chip';
import { Input } from '@web/components/Input/Input';
import { categoryLabel } from '@web/utils/categories';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useNurseApi } from '../../api/api-context';
import { useAuth } from '../../auth/useAuth';
import { useFocusAfterRender } from '../../hooks/useFocusAfterRender';
import { ChipGroup } from '../../components/ChipGroup';
import { StepHeader } from '../../components/StepHeader';
import {
  GENDER_OPTIONS,
  LICENCE_FIELD_ORDER,
  ROLE_OPTIONS,
  licenceFormFrom,
  normaliseLicenceNumber,
  validateLicenceForm,
  type LicenceErrors,
  type LicenceField,
  type LicenceForm,
} from '../../onboarding/onboarding';
import { useReadyProfile } from '../../onboarding/profile-context';
import { paths } from '../../routes/paths';
import styles from './onboarding.module.css';

/** Server fields that map to an input on this screen. */
const FIELD_FROM_SERVER: Record<string, LicenceField> = {
  role: 'role',
  fullName: 'fullName',
  fullNameConfirmed: 'fullNameConfirmed',
  licenceNumber: 'licenceNumber',
  yearsOfPractice: 'yearsOfPractice',
  gender: 'gender',
  topics: 'topics',
};

/*
 * N02 Verify licence (Figma "N02 Verify licence", "D-N02"). Step 1 of 3.
 * Saves with PATCH /nurse/profile, then PATCH /nurse/preferences for topics.
 *
 * Added to the frame (docs/QUESTIONS.md, H9):
 * - "This is my name exactly as on my licence": fullNameConfirmed is required to submit.
 * - Gender (optional): the only way a nurse can receive "female health workers only" questions.
 * - A "General" chip: the fifth topic, otherwise reachable only through "All topics".
 */
export function LicencePage() {
  const api = useNurseApi();
  const { sessionExpired } = useAuth();
  const { profile, setProfile, reload } = useReadyProfile();
  const navigate = useNavigate();

  const [form, setForm] = useState<LicenceForm>(() => licenceFormFrom(profile));
  /** Topics follow the role's defaults until she changes them herself. */
  const [topicsTouched, setTopicsTouched] = useState(profile.topics.length > 0);
  const [errors, setErrors] = useState<LicenceErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const roleRef = useRef<HTMLFieldSetElement>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const confirmedRef = useRef<HTMLInputElement>(null);
  const licenceRef = useRef<HTMLInputElement>(null);
  const yearsRef = useRef<HTMLInputElement>(null);
  const genderRef = useRef<HTMLFieldSetElement>(null);
  const topicsRef = useRef<HTMLFieldSetElement>(null);

  const focusLater = useFocusAfterRender();

  /** Event handlers only: moves focus to the field with a problem (after the re-render). */
  const focusField = (field: LicenceField) => focusLater(() => fieldElement(field));
  const fieldElement = (field: LicenceField): HTMLElement | null => {
    const byField: Record<LicenceField, HTMLElement | null> = {
      role: roleRef.current,
      fullName: fullNameRef.current,
      fullNameConfirmed: confirmedRef.current,
      licenceNumber: licenceRef.current,
      yearsOfPractice: yearsRef.current,
      gender: genderRef.current,
      topics: topicsRef.current,
    };
    return byField[field];
  };

  const update = (patch: Partial<LicenceForm>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (submitted) setErrors(validateLicenceForm(next));
  };

  const chooseRole = (role: LicenceForm['role']) => {
    if (!role) return;
    update(topicsTouched ? { role } : { role, topics: [...DEFAULT_TOPICS_BY_ROLE[role]] });
  };

  const toggleTopic = (topic: QuestionCategory) => {
    setTopicsTouched(true);
    const has = form.topics.includes(topic);
    update({
      topics: QUESTION_CATEGORIES.filter((t) => (t === topic ? !has : form.topics.includes(t))),
    });
  };

  const allTopics = QUESTION_CATEGORIES.every((t) => form.topics.includes(t));
  const toggleAllTopics = () => {
    setTopicsTouched(true);
    update({ topics: allTopics ? [] : [...QUESTION_CATEGORIES] });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSubmitted(true);
    setFormError(undefined);
    const found = validateLicenceForm(form);
    setErrors(found);
    const first = LICENCE_FIELD_ORDER.find((f) => found[f]);
    if (first) return focusField(first);

    setSaving(true);
    try {
      let latest: NurseProfile = profile;
      const body = changedFields(form, profile);
      if (Object.keys(body).length > 0) latest = await api.nurse.updateProfile(body);
      const topicsChanged =
        latest.topics.length !== form.topics.length ||
        form.topics.some((t) => !latest.topics.includes(t));
      if (topicsChanged) latest = await api.nurse.updatePreferences({ topics: form.topics });
      setProfile(latest);
      navigate(paths.documents);
    } catch (error) {
      setSaving(false);
      if (isSessionError(error)) return sessionExpired();
      const field = isApiError(error) ? error.details?.field : undefined;
      const mapped = typeof field === 'string' ? FIELD_FROM_SERVER[field] : undefined;
      if (
        mapped &&
        (hasErrorCode(error, 'VALIDATION_FAILED') ||
          hasErrorCode(error, 'TOPICS_REQUIRED') ||
          (hasErrorCode(error, 'CONFLICT') && mapped === 'licenceNumber'))
      ) {
        setErrors({ [mapped]: (error as Error).message });
        focusField(mapped);
        return;
      }
      if (hasErrorCode(error, 'CONFLICT')) {
        // Locked: an admin is reviewing, or she was approved meanwhile. Reload sends her on.
        setFormError((error as Error).message);
        void reload();
        return;
      }
      setFormError(loadErrorMessage(error, 'We could not save your details. Please try again.'));
    }
  };

  const busy = saving;

  return (
    <div className={styles.page}>
      <StepHeader step={1} caption="Step 1 of 3, about 5 minutes" />

      <div>
        <h1 className={styles.title}>Your licence</h1>
      </div>
      <p className={styles.lede}>
        We check this with the Nursing and Midwifery Council of Nigeria before you can answer.
      </p>

      {profile.verificationStatus === 'rejected' && profile.rejectionReason && (
        <Alert tone="info">
          <strong>What to fix:</strong> {profile.rejectionReason}
        </Alert>
      )}
      {formError && <Alert tone="error">{formError}</Alert>}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <ChipGroup legend="I am a" error={errors.role} ref={roleRef}>
          {ROLE_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              selected={form.role === option.value}
              onClick={() => chooseRole(option.value)}
              disabled={busy}
            >
              {option.label}
            </Chip>
          ))}
        </ChipGroup>

        <Input
          ref={fullNameRef}
          label="Full name, as on your licence"
          autoComplete="name"
          autoCapitalize="words"
          maxLength={110}
          value={form.fullName}
          error={errors.fullName}
          disabled={busy}
          onChange={(e) => update({ fullName: e.target.value, fullNameConfirmed: false })}
        />
        <Checkbox
          ref={confirmedRef}
          checked={form.fullNameConfirmed}
          error={errors.fullNameConfirmed}
          disabled={busy}
          onChange={(e) => update({ fullNameConfirmed: e.target.checked })}
        >
          This is my name exactly as it appears on my licence
        </Checkbox>

        <Input
          ref={licenceRef}
          label="Licence number"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          value={form.licenceNumber}
          error={errors.licenceNumber}
          disabled={busy}
          onChange={(e) => update({ licenceNumber: e.target.value })}
        />
        <Input
          ref={yearsRef}
          label="Years of practice"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={2}
          value={form.yearsOfPractice}
          error={errors.yearsOfPractice}
          disabled={busy}
          onChange={(e) => update({ yearsOfPractice: e.target.value })}
        />

        <ChipGroup
          legend="Gender (optional)"
          hint="Women can ask for a female health worker. We never show this on your profile."
          ref={genderRef}
        >
          {GENDER_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              selected={form.gender === option.value}
              onClick={() => update({ gender: form.gender === option.value ? null : option.value })}
              disabled={busy}
            >
              {option.label}
            </Chip>
          ))}
        </ChipGroup>

        <ChipGroup
          legend="Topics you’ll answer"
          hint="You’ll only get alerts for these. You can change them later."
          error={errors.topics}
          ref={topicsRef}
        >
          {QUESTION_CATEGORIES.map((topic) => (
            <Chip
              key={topic}
              selected={form.topics.includes(topic)}
              onClick={() => toggleTopic(topic)}
              disabled={busy}
            >
              {categoryLabel(topic)}
            </Chip>
          ))}
          <Chip selected={allTopics} onClick={toggleAllTopics} disabled={busy}>
            All topics
          </Chip>
        </ChipGroup>

        <div className={styles.actions}>
          <Button type="submit" fullWidth disabled={busy} aria-busy={saving || undefined}>
            {saving ? 'Saving…' : 'Continue'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Only what changed: PATCH refuses an empty body, and unchanged licence fields need no check. */
function changedFields(form: LicenceForm, profile: NurseProfile): UpdateNurseProfileBody {
  const body: UpdateNurseProfileBody = {};
  if (form.role && form.role !== profile.role) body.role = form.role;
  const fullName = form.fullName.trim();
  if (fullName !== profile.fullName) body.fullName = fullName;
  if (form.fullNameConfirmed !== profile.fullNameConfirmed) {
    body.fullNameConfirmed = form.fullNameConfirmed;
  }
  const licence = normaliseLicenceNumber(form.licenceNumber);
  if (licence !== profile.licenceNumber) body.licenceNumber = licence;
  const years = Number(form.yearsOfPractice.trim());
  if (years !== profile.yearsOfPractice) body.yearsOfPractice = years;
  if (form.gender !== profile.gender) body.gender = form.gender;
  return body;
}
