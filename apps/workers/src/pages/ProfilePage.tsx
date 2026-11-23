import {
  NURSE_BIO_MAX_LENGTH,
  NURSE_LANGUAGES,
  QUESTION_CATEGORIES,
  type Gender,
  type NurseLanguage,
  type NurseProfile,
  type QuestionCategory,
  type UpdateNurseProfileBody,
} from '@carelayer/shared';
import { isApiError } from '@web/api/errors';
import { isSessionError } from '@web/auth/auth-flow';
import { Alert } from '@web/components/Alert/Alert';
import { Avatar } from '@web/components/Avatar/Avatar';
import { Badge } from '@web/components/Badge/Badge';
import { Button, ButtonLink } from '@web/components/Button/Button';
import { Chip } from '@web/components/Chip/Chip';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import { Input } from '@web/components/Input/Input';
import { Toggle } from '@web/components/Toggle/Toggle';
import { categoryLabel } from '@web/utils/categories';
import { formatListDate } from '@web/utils/dates';
import { useId, useState, type FormEvent } from 'react';
import { useNurseApi } from '../api/api-context';
import { useAuth } from '../auth/useAuth';
import { ChipGroup } from '../components/ChipGroup';
import { DOCUMENT_SLOTS, GENDER_OPTIONS } from '../onboarding/onboarding';
import { useReadyProfile } from '../onboarding/profile-context';
import { paths } from '../routes/paths';
import { languageLabel, roleLabel } from '../workspace/format';
import styles from '../workspace/workspace.module.css';

/*
 * Profile (no frame; docs/TASKS.md §3 "Nurse profile").
 *   GET /nurse/profile (already loaded), PATCH /nurse/profile, PATCH /nurse/preferences.
 * Editable only where apps/api allows it: once verified, the licence fields
 * (name, role, licence number) and documents are locked (409 CONFLICT);
 * bio, languages, years, practice area and gender stay editable.
 */
export function ProfilePage() {
  const { profile } = useReadyProfile();
  const [editing, setEditing] = useState(false);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Profile</h1>
        <ButtonLink to={paths.settings} variant="ghost">
          Settings
        </ButtonLink>
      </header>

      <section className={styles.card} aria-label="Your profile">
        <div className={styles.rowStart}>
          <Avatar name={profile.fullName} size={64} decorative />
          <div className={styles.stack}>
            <span className={styles.titleSmall}>{profile.fullName}</span>
            <span>
              <Badge variant="verified">Verified {roleLabel(profile.role).toLowerCase()}</Badge>
            </span>
          </div>
        </div>
        <p className={cx(styles.bodySmall, styles.muted)}>
          {profile.helpful.percent !== null
            ? `${profile.helpful.percent}% helpful (${profile.helpful.count})`
            : 'No feedback yet'}
          {profile.avgResponseMinutes !== null &&
            ` · answers in about ${profile.avgResponseMinutes} min`}
        </p>
        <p className={cx(styles.caption, styles.muted)}>
          Women see your name, role, years, languages, bio and rating when they choose who answers.
          Never your email, phone or licence number.
        </p>
      </section>

      {editing ? (
        <ProfileForm onDone={() => setEditing(false)} />
      ) : (
        <ProfileDetails profile={profile} onEdit={() => setEditing(true)} />
      )}

      <AvailabilityAndTopics />
      <Verification profile={profile} />
    </div>
  );
}

function ProfileDetails({ profile, onEdit }: { profile: NurseProfile; onEdit: () => void }) {
  const rows: Array<[string, string]> = [
    [
      'Years of practice',
      profile.yearsOfPractice === null ? 'Not set' : `${profile.yearsOfPractice}`,
    ],
    ['Practice area', profile.practiceArea ?? 'Not set'],
    ['Languages', profile.languages.map(languageLabel).join(', ') || 'Not set'],
    ['Gender', GENDER_OPTIONS.find((g) => g.value === profile.gender)?.label ?? 'Not set'],
  ];
  return (
    <section className={styles.card} aria-label="About you">
      <div className={styles.row}>
        <h2 className={styles.cardTitle}>About you</h2>
        <Button variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <p className={styles.bodySmall}>
        {profile.bio || 'Add a short bio so women know who you are.'}
      </p>
      <dl className={styles.list} style={{ margin: 0 }}>
        {rows.map(([term, value]) => (
          <div key={term} className={styles.listItem}>
            <dt className={styles.muted}>{term}</dt>
            <dd className={styles.label} style={{ margin: 0, textAlign: 'right' }}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {profile.gender === null && (
        <p className={cx(styles.caption, styles.muted)}>
          Women can ask for a female health worker. Without a gender you won’t get those questions.
        </p>
      )}
    </section>
  );
}

type FormErrors = Partial<Record<'yearsOfPractice' | 'practiceArea' | 'bio' | 'languages', string>>;

function ProfileForm({ onDone }: { onDone: () => void }) {
  const api = useNurseApi();
  const { sessionExpired } = useAuth();
  const { profile, setProfile } = useReadyProfile();
  const bioId = useId();
  const [years, setYears] = useState(profile.yearsOfPractice?.toString() ?? '');
  const [practiceArea, setPracticeArea] = useState(profile.practiceArea ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [languages, setLanguages] = useState<NurseLanguage[]>(profile.languages);
  const [gender, setGender] = useState<Gender | null>(profile.gender);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const toggleLanguage = (l: NurseLanguage) =>
    setLanguages((current) =>
      current.includes(l) ? current.filter((x) => x !== l) : [...current, l],
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: FormErrors = {};
    const yearsNumber = Number(years);
    if (
      years.trim() === '' ||
      !Number.isInteger(yearsNumber) ||
      yearsNumber < 0 ||
      yearsNumber > 60
    ) {
      next.yearsOfPractice = 'Enter whole years, from 0 to 60.';
    }
    const area = practiceArea.trim();
    if (area && (area.length < 2 || area.length > 100)) {
      next.practiceArea = 'Use 2 to 100 characters.';
    }
    if (bio.trim().length > NURSE_BIO_MAX_LENGTH) {
      next.bio = `Keep your bio to ${NURSE_BIO_MAX_LENGTH} characters.`;
    }
    if (languages.length === 0) next.languages = 'Choose at least one language.';
    setErrors(next);
    if (Object.keys(next).length) return;

    // Only what changed, and never the licence fields (locked once verified).
    const body: UpdateNurseProfileBody = {};
    if (yearsNumber !== profile.yearsOfPractice) body.yearsOfPractice = yearsNumber;
    if (area && area !== profile.practiceArea) body.practiceArea = area;
    if (bio.trim() !== (profile.bio ?? '')) body.bio = bio.trim();
    if (
      languages.length !== profile.languages.length ||
      languages.some((l) => !profile.languages.includes(l))
    ) {
      body.languages = NURSE_LANGUAGES.filter((l) => languages.includes(l));
    }
    if (gender !== profile.gender) body.gender = gender;
    if (Object.keys(body).length === 0) {
      onDone();
      return;
    }
    setSaving(true);
    setFormError(undefined);
    try {
      setProfile(await api.nurse.updateProfile(body));
      onDone();
    } catch (e) {
      if (isSessionError(e)) sessionExpired();
      setSaving(false);
      const field = isApiError(e) ? (e.details?.field as keyof FormErrors | undefined) : undefined;
      if (isApiError(e) && e.code === 'VALIDATION_FAILED' && field) {
        setErrors({ [field]: e.message });
      } else {
        setFormError(
          isApiError(e) && e.status === 0
            ? 'Could not reach CareLayer. Check your connection and try again.'
            : 'We could not save your profile. Please try again.',
        );
      }
    }
  };

  return (
    <form
      className={styles.card}
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-label="Edit profile"
    >
      <h2 className={styles.cardTitle}>Edit about you</h2>
      <Alert tone="info">
        Your name, role and licence number were checked by CareLayer, so they can’t be changed here.
        Contact support if they are wrong.
      </Alert>
      <Input
        label="Years of practice"
        inputMode="numeric"
        value={years}
        onChange={(e) => setYears(e.target.value)}
        error={errors.yearsOfPractice}
      />
      <Input
        label="Practice area (optional)"
        hint="For example: antenatal clinic, Lagos"
        value={practiceArea}
        onChange={(e) => setPracticeArea(e.target.value)}
        error={errors.practiceArea}
      />
      <div>
        <label htmlFor={bioId} className={styles.fieldLabel}>
          Short bio
        </label>
        <textarea
          id={bioId}
          className={cx(styles.textarea, errors.bio && styles.textareaError)}
          style={{ minHeight: '6rem' }}
          value={bio}
          maxLength={NURSE_BIO_MAX_LENGTH}
          onChange={(e) => setBio(e.target.value)}
          aria-describedby={`${bioId}-count`}
        />
        <div className={styles.row}>
          {errors.bio ? <p className={styles.fieldError}>{errors.bio}</p> : <span />}
          <span id={`${bioId}-count`} className={cx(styles.caption, styles.muted)}>
            {bio.trim().length} / {NURSE_BIO_MAX_LENGTH}
          </span>
        </div>
      </div>
      <ChipGroup legend="Languages you answer in" error={errors.languages}>
        {NURSE_LANGUAGES.map((l) => (
          <Chip key={l} selected={languages.includes(l)} onClick={() => toggleLanguage(l)}>
            {languageLabel(l)}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup
        legend="Gender (optional)"
        hint="Women can ask for a female health worker. We never show this on your profile."
      >
        {GENDER_OPTIONS.map((g) => (
          <Chip
            key={g.value}
            selected={gender === g.value}
            onClick={() => setGender(gender === g.value ? null : g.value)}
          >
            {g.label}
          </Chip>
        ))}
      </ChipGroup>
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className={styles.actions}>
        <Button type="button" variant="secondary" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

/** Available toggle and "Topics I answer" (at least one; topics control alerts only). */
function AvailabilityAndTopics() {
  const api = useNurseApi();
  const { sessionExpired } = useAuth();
  const { profile, setProfile } = useReadyProfile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const save = async (body: { topics?: QuestionCategory[]; available?: boolean }) => {
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      setProfile(await api.nurse.updatePreferences(body));
      setSaved(true);
    } catch (e) {
      if (isSessionError(e)) sessionExpired();
      setError(
        isApiError(e) && e.code === 'TOPICS_REQUIRED'
          ? 'Choose at least one topic you answer.'
          : 'We could not save that. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleTopic = (topic: QuestionCategory) => {
    const next = profile.topics.includes(topic)
      ? profile.topics.filter((t) => t !== topic)
      : [...profile.topics, topic];
    if (next.length === 0) {
      setError('Choose at least one topic you answer.');
      return;
    }
    void save({ topics: QUESTION_CATEGORIES.filter((t) => next.includes(t)) });
  };

  return (
    <section className={styles.card} aria-label="Availability and topics">
      <h2 className={styles.cardTitle}>Availability and topics</h2>
      <Toggle
        checked={profile.available}
        onCheckedChange={(available) => void save({ available })}
        disabled={saving}
        label="Available for new questions"
        description="When off, you get no alerts. You can still answer waiting questions."
      />
      <ChipGroup
        legend="Topics I answer"
        hint="You get alerts for these. You can still see and answer every waiting question."
      >
        {QUESTION_CATEGORIES.map((t) => (
          <Chip
            key={t}
            selected={profile.topics.includes(t)}
            onClick={() => toggleTopic(t)}
            disabled={saving}
          >
            {categoryLabel(t)}
          </Chip>
        ))}
      </ChipGroup>
      {error && <Alert tone="error">{error}</Alert>}
      {saved && !error && (
        <p className={cx(styles.caption, styles.muted)} role="status">
          Saved
        </p>
      )}
    </section>
  );
}

function Verification({ profile }: { profile: NurseProfile }) {
  return (
    <section className={styles.card} aria-label="Licence and documents">
      <h2 className={styles.cardTitle}>Licence and documents</h2>
      <dl className={styles.list} style={{ margin: 0 }}>
        <div className={styles.listItem}>
          <dt className={styles.muted}>Role</dt>
          <dd className={styles.label} style={{ margin: 0 }}>
            Registered {roleLabel(profile.role).toLowerCase()}
          </dd>
        </div>
        <div className={styles.listItem}>
          <dt className={styles.muted}>Licence number (NMCN)</dt>
          <dd className={styles.label} style={{ margin: 0 }}>
            {profile.licenceNumber ?? 'Not set'}
          </dd>
        </div>
        <div className={styles.listItem}>
          <dt className={styles.muted}>Status</dt>
          <dd className={styles.label} style={{ margin: 0 }}>
            {profile.verificationStatus === 'approved' ? 'Verified' : 'In review'}
          </dd>
        </div>
      </dl>
      <ul role="list" className={styles.list}>
        {DOCUMENT_SLOTS.map((slot) => {
          const doc = profile.documents.find((d) => d.type === slot.type);
          return (
            <li key={slot.type} className={styles.listItem}>
              <span className={styles.rowStart}>
                <span className={styles.listIcon} aria-hidden>
                  <Icon name={doc ? 'check' : 'alert'} size={16} />
                </span>
                <span className={styles.stack}>
                  <span className={styles.label}>{slot.title}</span>
                  <span className={cx(styles.caption, styles.muted)}>
                    {doc ? `Uploaded ${formatListDate(doc.uploadedAt)} · checked` : 'Missing'}
                  </span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className={cx(styles.caption, styles.muted)}>
        Documents are locked after verification. They are never shown to the women you help.
      </p>
    </section>
  );
}
