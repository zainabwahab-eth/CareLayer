import {
  NURSE_DOCUMENT_TYPES,
  NURSE_DOCUMENT_UPLOAD,
  type Gender,
  type NurseDocumentType,
  type NurseProfile,
  type NurseRole,
  type OnboardingRequirement,
  type QuestionCategory,
} from '@carelayer/shared';
import { paths } from '../routes/paths';

/*
 * Onboarding rules for N02-N04, kept out of the screens so they can be tested.
 * Validation mirrors apps/api's UpdateNurseProfileSchema (src/modules/nurses/profile.ts)
 * so she sees the same message before sending as the server would give.
 */

// ---- N02 Verify licence -----------------------------------------------------

export interface LicenceForm {
  role: NurseRole | null;
  fullName: string;
  fullNameConfirmed: boolean;
  licenceNumber: string;
  /** As typed: validated into a whole number of years. */
  yearsOfPractice: string;
  gender: Gender | null;
  topics: QuestionCategory[];
}

export type LicenceField = keyof LicenceForm;
export type LicenceErrors = Partial<Record<LicenceField, string>>;

export const ROLE_OPTIONS: ReadonlyArray<{ value: NurseRole; label: string }> = [
  { value: 'nurse', label: 'Registered nurse' },
  { value: 'midwife', label: 'Registered midwife' },
];

export const GENDER_OPTIONS: ReadonlyArray<{ value: Gender; label: string }> = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

/** Topic chips in Figma N02 order. "All topics" selects every category (General included). */
export const TOPIC_CHIPS: readonly QuestionCategory[] = [
  'pregnancy',
  'periods',
  'contraception',
  'sexual_health',
];

const LICENCE_PATTERN = /^[A-Za-z0-9/ -]+$/;

export function licenceFormFrom(profile: NurseProfile): LicenceForm {
  return {
    role: profile.role,
    fullName: profile.fullName,
    fullNameConfirmed: profile.fullNameConfirmed,
    licenceNumber: profile.licenceNumber ?? '',
    yearsOfPractice: profile.yearsOfPractice === null ? '' : String(profile.yearsOfPractice),
    gender: profile.gender,
    topics: profile.topics,
  };
}

export function validateLicenceForm(form: LicenceForm): LicenceErrors {
  const errors: LicenceErrors = {};
  if (!form.role) errors.role = 'Choose whether you are a registered nurse or midwife.';

  const name = form.fullName.trim();
  if (name.length < 2) errors.fullName = 'Enter your full name as on your licence.';
  else if (name.length > 100) errors.fullName = 'Use 100 characters or fewer.';

  if (!form.fullNameConfirmed) {
    errors.fullNameConfirmed = 'Confirm that this is your name exactly as on your licence.';
  }

  const licence = form.licenceNumber.trim();
  if (licence.length < 3) errors.licenceNumber = 'Enter your licence number.';
  else if (licence.length > 40) errors.licenceNumber = 'Use 40 characters or fewer.';
  else if (!LICENCE_PATTERN.test(licence)) {
    errors.licenceNumber = 'Use letters, numbers, spaces, - or / only.';
  }

  const years = form.yearsOfPractice.trim();
  if (!years) errors.yearsOfPractice = 'Enter your years of practice.';
  else if (!/^\d+$/.test(years)) errors.yearsOfPractice = 'Use whole years, like 9.';
  else if (Number(years) > 60) errors.yearsOfPractice = 'Enter a number from 0 to 60.';

  if (form.topics.length === 0) errors.topics = 'Choose at least one topic you’ll answer.';
  return errors;
}

/** The order errors are focused in (top of the form first). */
export const LICENCE_FIELD_ORDER: readonly LicenceField[] = [
  'role',
  'fullName',
  'fullNameConfirmed',
  'licenceNumber',
  'yearsOfPractice',
  'gender',
  'topics',
];

/** How the server writes licence numbers (upper case, single spaces), to compare. */
export function normaliseLicenceNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

// ---- N03 Documents ----------------------------------------------------------

export interface DocumentSlot {
  type: NurseDocumentType;
  title: string;
  description: string;
  /** Selfie: open the front camera on phones. */
  capture?: 'user';
}

/** N03 rows in Figma order. */
export const DOCUMENT_SLOTS: readonly DocumentSlot[] = [
  {
    type: 'practising_licence',
    title: 'Current practising licence',
    description: 'From the Nursing and Midwifery Council of Nigeria',
  },
  {
    type: 'registration_certificate',
    title: 'Certificate of registration',
    description: 'A clear photo or PDF',
  },
  {
    type: 'government_id',
    title: 'Government ID',
    description: 'NIN slip, passport or driver’s licence',
  },
  {
    type: 'selfie_with_id',
    title: 'Take a Selfie',
    description: 'Holding your ID, taken now with your camera',
    capture: 'user',
  },
];

/** What the file picker offers. The server still checks the bytes. */
export const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,.heic';

const ALLOWED_EXTENSIONS = /\.(pdf|jpe?g|png|webp|heic|heif)$/i;

/** Quick checks before uploading (size, obvious wrong type). The server sniffs the bytes. */
export function checkDocumentFile(file: File): string | undefined {
  if (file.size === 0) return 'That file is empty. Choose another one.';
  if (file.size > NURSE_DOCUMENT_UPLOAD.maxBytes) return 'Files can be up to 10 MB.';
  const typeOk =
    (NURSE_DOCUMENT_UPLOAD.allowedTypes as readonly string[]).includes(file.type) ||
    file.type === 'image/heif' ||
    ALLOWED_EXTENSIONS.test(file.name);
  if (!typeOk) return 'Upload a PDF or a photo (JPEG, PNG, WebP or HEIC).';
  return undefined;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- progress ---------------------------------------------------------------

export function isLicenceStepDone(p: NurseProfile): boolean {
  return (
    p.role !== null &&
    p.fullNameConfirmed &&
    p.licenceNumber !== null &&
    p.yearsOfPractice !== null &&
    p.topics.length > 0
  );
}

export function missingDocuments(p: NurseProfile): NurseDocumentType[] {
  const have = new Set(p.documents.map((d) => d.type));
  return NURSE_DOCUMENT_TYPES.filter((t) => !have.has(t));
}

/** Where a signed-in nurse belongs, given her profile. */
export function homePathFor(p: NurseProfile): string {
  switch (p.verificationStatus) {
    case 'approved':
      return paths.today;
    case 'pending_review':
    case 'rejected':
      return paths.review;
    case 'draft':
      if (!isLicenceStepDone(p)) return paths.licence;
      if (missingDocuments(p).length) return paths.documents;
      return paths.submit;
  }
}

/** Licence fields and documents are locked while the admin looks and after approval. */
export function isLocked(p: NurseProfile): boolean {
  return p.verificationStatus === 'pending_review' || p.verificationStatus === 'approved';
}

// ---- ONBOARDING_INCOMPLETE ---------------------------------------------------

const REQUIREMENT_TEXT: Record<OnboardingRequirement, { label: string; path: string }> = {
  role: { label: 'Choose nurse or midwife', path: paths.licence },
  fullNameConfirmed: { label: 'Confirm your name matches your licence', path: paths.licence },
  yearsOfPractice: { label: 'Add your years of practice', path: paths.licence },
  licenceNumber: { label: 'Add your licence number', path: paths.licence },
  guidanceNotDiagnosisAccepted: {
    label: 'Agree to give guidance, not diagnoses',
    path: paths.submit,
  },
  practising_licence: { label: 'Upload your practising licence', path: paths.documents },
  registration_certificate: {
    label: 'Upload your certificate of registration',
    path: paths.documents,
  },
  government_id: { label: 'Upload a government ID', path: paths.documents },
  selfie_with_id: { label: 'Take a selfie holding your ID', path: paths.documents },
};

export function describeRequirement(requirement: OnboardingRequirement) {
  return REQUIREMENT_TEXT[requirement];
}

/** details.missing from a 409 ONBOARDING_INCOMPLETE, keeping only values we know. */
export function readMissing(details: Record<string, unknown> | undefined): OnboardingRequirement[] {
  const raw = details?.missing;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is OnboardingRequirement => typeof v === 'string' && v in REQUIREMENT_TEXT,
  );
}
