import {
  AUTH_RULES,
  DEFAULT_TOPICS_BY_ROLE,
  LICENCE_FIELDS,
  NURSE_BIO_MAX_LENGTH,
  NURSE_DOCUMENT_TYPES,
  NURSE_DOCUMENT_UPLOAD,
  NURSE_LANGUAGES,
  QUESTION_CATEGORIES,
  type ApiErrorCode,
  type AuthTokensResponse,
  type NurseDocument,
  type NurseDocumentType,
  type NurseProfile,
  type OnboardingRequirement,
  type UpdateNurseProfileBody,
  type User,
} from '@carelayer/shared';
import { ApiError } from '@web/api/errors';
import type { NurseApi } from './types';

/*
 * In-browser mock of the nurse endpoints, following apps/api's rules
 * (src/modules/nurses/profile.ts) so screens behave the same in both modes:
 * field validation with details.field, licence fields and documents locked
 * while pending_review / approved, licence numbers unique, topics defaulted
 * from the role, file type sniffed from the first bytes, ONBOARDING_INCOMPLETE
 * with details.missing.
 *
 * - Sign-in code for any email: MOCK_VERIFICATION_CODE ("123456").
 * - Seeded accounts: amaka@example.com (approved), funmi@example.com
 *   (pending review), hauwa@example.com (rejected). Licence RM 000001 is taken.
 * - State lives in sessionStorage, so a reload keeps new sign-ups in this tab.
 */
export const MOCK_VERIFICATION_CODE = '123456';
const STORAGE_KEY = 'carelayer.workers.mock';

interface MockNurse {
  user: User;
  profile: NurseProfile;
  attempts: number;
}

interface MockState {
  nurses: Record<string, MockNurse>;
  /** Email of the signed-in nurse (stands in for the refresh cookie). */
  session: string | null;
  nextId: number;
}

const fail = (
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): never => {
  throw new ApiError(status, code, message, details);
};

const iso = (ms = Date.now()) => new Date(ms).toISOString();

function emptyProfile(userId: string, fullName: string): NurseProfile {
  return {
    userId,
    role: null,
    fullName,
    fullNameConfirmed: false,
    gender: null,
    practiceArea: null,
    yearsOfPractice: null,
    bio: null,
    languages: [],
    licenceNumber: null,
    documents: [],
    custodialStellarAddress: 'GMOCKCUSTODIALADDRESSFORTHENURSEAPPONLY0000000000000000',
    ownStellarAddress: null,
    guidanceNotDiagnosisAccepted: false,
    verificationStatus: 'draft',
    rejectionReason: null,
    topics: [],
    available: true,
    avgResponseMinutes: null,
    helpful: { percent: null, count: 0 },
  };
}

function mockDocuments(): NurseDocument[] {
  return NURSE_DOCUMENT_TYPES.map((type, i) => ({
    id: `doc_seed_${type}`,
    type,
    fileName: `${type}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 180_000 + i * 1000,
    uploadedAt: iso(Date.now() - 3 * 86_400_000),
  }));
}

function seed(): MockState {
  const make = (
    n: number,
    email: string,
    fullName: string,
    patch: Partial<NurseProfile>,
  ): [string, MockNurse] => {
    const id = `mock_nurse_${n}`;
    return [
      email,
      {
        user: { id, role: 'nurse', displayName: fullName, email, createdAt: iso() },
        profile: { ...emptyProfile(id, fullName), ...patch },
        attempts: 0,
      },
    ];
  };
  const complete: Partial<NurseProfile> = {
    role: 'midwife',
    fullNameConfirmed: true,
    gender: 'female',
    yearsOfPractice: 9,
    languages: ['english', 'igbo'],
    documents: mockDocuments(),
    guidanceNotDiagnosisAccepted: true,
    topics: [...DEFAULT_TOPICS_BY_ROLE.midwife],
  };
  return {
    nurses: Object.fromEntries([
      make(1, 'amaka@example.com', 'Amaka Okafor', {
        ...complete,
        licenceNumber: 'RM 000001',
        verificationStatus: 'approved',
      }),
      make(2, 'funmi@example.com', 'Funmilayo Bello', {
        ...complete,
        licenceNumber: 'RM 000002',
        verificationStatus: 'pending_review',
      }),
      make(3, 'hauwa@example.com', 'Hauwa Musa', {
        ...complete,
        licenceNumber: 'RM 000003',
        verificationStatus: 'rejected',
        rejectionReason:
          'The photo of your practising licence is too blurry to read. Upload a clearer photo.',
      }),
    ]),
    session: null,
    nextId: 4,
  };
}

/** The first bytes of a file. FileReader where Blob.arrayBuffer is missing (old Safari, jsdom). */
function readHead(file: Blob, length: number): Promise<Uint8Array> {
  const head = file.slice(0, length);
  if (typeof head.arrayBuffer === 'function') {
    return head.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(head);
  });
}

/** Same sniffing as apps/api (documents.ts): the type comes from the bytes, not the name. */
export async function detectDocumentType(file: Blob): Promise<string | null> {
  const b = await readHead(file, 32);
  const text = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 5 && text(0, 5) === '%PDF-') return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return 'image/png';
  if (b.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && text(4, 8) === 'ftyp') {
    const brand = text(8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) {
      return 'image/heic';
    }
  }
  return null;
}

function missingForSubmit(p: NurseProfile): OnboardingRequirement[] {
  const missing: OnboardingRequirement[] = [];
  if (!p.role) missing.push('role');
  if (!p.fullNameConfirmed) missing.push('fullNameConfirmed');
  if (p.yearsOfPractice === null) missing.push('yearsOfPractice');
  if (!p.licenceNumber) missing.push('licenceNumber');
  if (!p.guidanceNotDiagnosisAccepted) missing.push('guidanceNotDiagnosisAccepted');
  const have = new Set(p.documents.map((d) => d.type));
  for (const t of NURSE_DOCUMENT_TYPES) if (!have.has(t)) missing.push(t);
  return missing;
}

const isLocked = (p: NurseProfile) =>
  p.verificationStatus === 'pending_review' || p.verificationStatus === 'approved';

const invalid = (field: string, message: string) =>
  fail(400, 'VALIDATION_FAILED', message, { field });

/** The checks UpdateNurseProfileSchema makes, returning the normalised body. */
function validateProfileBody(body: UpdateNurseProfileBody): UpdateNurseProfileBody {
  const allowed = new Set([
    'fullName',
    'role',
    'fullNameConfirmed',
    'gender',
    'practiceArea',
    'yearsOfPractice',
    'bio',
    'languages',
    'licenceNumber',
    'guidanceNotDiagnosisAccepted',
  ]);
  const keys = Object.keys(body);
  const unknown = keys.find((k) => !allowed.has(k));
  if (unknown) invalid(unknown, `Unrecognized key: "${unknown}"`);
  if (keys.length === 0) invalid('', 'Send at least one field to change.');
  const out: UpdateNurseProfileBody = { ...body };
  if (body.fullName !== undefined) {
    const v = body.fullName.trim();
    if (v.length < 2) invalid('fullName', 'Enter your full name as on your licence.');
    if (v.length > 100) invalid('fullName', 'Too big: expected string to have <=100 characters');
    out.fullName = v;
  }
  if (body.role !== undefined && body.role !== 'nurse' && body.role !== 'midwife') {
    invalid('role', 'Invalid option: expected one of "nurse"|"midwife"');
  }
  if (body.yearsOfPractice !== undefined) {
    const y = body.yearsOfPractice;
    if (!Number.isInteger(y)) invalid('yearsOfPractice', 'Use whole years.');
    if (y < 0 || y > 60) invalid('yearsOfPractice', 'Too big: expected number to be <=60');
  }
  if (body.bio !== undefined && body.bio.trim().length > NURSE_BIO_MAX_LENGTH) {
    invalid('bio', `Keep your bio to ${NURSE_BIO_MAX_LENGTH} characters.`);
  }
  if (body.languages !== undefined) {
    if (body.languages.length === 0) invalid('languages', 'Choose at least one language.');
    if (body.languages.some((l) => !NURSE_LANGUAGES.includes(l))) invalid('languages', 'Invalid');
  }
  if (body.licenceNumber !== undefined) {
    const v = body.licenceNumber.trim();
    if (v.length < 3) invalid('licenceNumber', 'Enter your licence number.');
    if (v.length > 40) invalid('licenceNumber', 'Too big: expected string to have <=40 characters');
    if (!/^[A-Za-z0-9/ -]+$/.test(v)) {
      invalid('licenceNumber', 'Use letters, numbers, spaces, - or / only.');
    }
    out.licenceNumber = v.toUpperCase().replace(/\s+/g, ' ');
  }
  return out;
}

export interface MockNurseApiOptions {
  /** Simulated network delay. Tests pass 0. */
  latencyMs?: number;
  /** Persist in sessionStorage (default true). Tests pass false for isolation. */
  persist?: boolean;
}

export function createMockNurseApi(options: MockNurseApiOptions = {}): NurseApi {
  const { latencyMs = 400, persist = true } = options;

  let state: MockState = seed();
  if (persist) {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (stored) state = JSON.parse(stored) as MockState;
    } catch {
      // Unreadable: start from the seed.
    }
  }
  const save = () => {
    if (!persist) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable: state lasts for this page only.
    }
  };

  async function respond<T>(produce: () => T | Promise<T>): Promise<T> {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    const result = await produce();
    save();
    return structuredClone(result);
  }

  const current = (): MockNurse => {
    const nurse = state.session ? state.nurses[state.session] : undefined;
    return nurse ?? fail(401, 'UNAUTHENTICATED', 'Please sign in again.');
  };

  const signIn = (nurse: MockNurse): AuthTokensResponse => {
    state.session = nurse.user.email;
    return {
      accessToken: `mock_access_${nurse.user.id}`,
      accessTokenExpiresAt: iso(Date.now() + AUTH_RULES.accessTokenTtlMinutes * 60_000),
      user: nurse.user,
    };
  };

  const createNurse = (email: string, name: string): MockNurse => {
    const id = `mock_nurse_${state.nextId++}`;
    const nurse: MockNurse = {
      user: { id, role: 'nurse', displayName: name, email, createdAt: iso() },
      profile: emptyProfile(id, name),
      attempts: 0,
    };
    state.nurses[email] = nurse;
    return nurse;
  };

  const checkApp = (app: string) => {
    if (app !== 'nurses') fail(403, 'WRONG_APP', 'This account is for the other app.');
  };

  const requireName = (name: string | undefined) => {
    const trimmed = name?.trim() ?? '';
    if (!trimmed) invalid('name', 'Enter your full name, as on your licence.');
    if (trimmed.length > 100) invalid('name', 'Use 100 characters or fewer.');
    return trimmed;
  };

  return {
    mode: 'mock',

    auth: {
      requestCode: (body) =>
        respond(() => {
          checkApp(body.app);
          const email = body.email.trim().toLowerCase();
          const existing = state.nurses[email];
          if (body.purpose === 'signup') {
            requireName(body.name);
            if (existing) fail(409, 'ACCOUNT_EXISTS', 'You already have an account.');
          } else if (!existing) {
            fail(404, 'ACCOUNT_NOT_FOUND', 'We could not find an account with this email.');
          }
          return {
            sent: true as const,
            resendAvailableAt: iso(Date.now() + AUTH_RULES.resendAfterSeconds * 1000),
          };
        }),

      verifyCode: (body) =>
        respond(() => {
          checkApp(body.app);
          const email = body.email.trim().toLowerCase();
          if (body.code !== MOCK_VERIFICATION_CODE) {
            const holder = state.nurses[email];
            const used = (holder?.attempts ?? 0) + 1;
            if (holder) holder.attempts = used;
            const remaining = Math.max(0, AUTH_RULES.codeMaxAttempts - used);
            if (remaining === 0) {
              fail(429, 'CODE_ATTEMPTS_EXCEEDED', 'Too many tries. Ask for a new code.');
            }
            fail(400, 'CODE_INVALID', 'That code is not right.', { attemptsRemaining: remaining });
          }
          let nurse = state.nurses[email];
          if (body.purpose === 'signup') {
            if (nurse) fail(409, 'ACCOUNT_EXISTS', 'You already have an account.');
            nurse = createNurse(email, requireName(body.name));
          } else if (!nurse) {
            fail(404, 'ACCOUNT_NOT_FOUND', 'We could not find an account with this email.');
          }
          nurse!.attempts = 0;
          return signIn(nurse!);
        }),

      signInWithGoogle: (body) =>
        respond(() => {
          checkApp(body.app);
          // Stand-in Google account for mock builds.
          const email = 'google.nurse@example.com';
          let nurse = state.nurses[email];
          if (body.mode === 'signup') {
            if (nurse) fail(409, 'ACCOUNT_EXISTS', 'You already have an account.');
            nurse = createNurse(email, body.name?.trim() || 'Ngozi Eze');
          } else if (!nurse) {
            fail(404, 'ACCOUNT_NOT_FOUND', 'We could not find an account with this email.');
          }
          return signIn(nurse!);
        }),

      refresh: () =>
        respond(() => {
          const nurse = state.session ? state.nurses[state.session] : undefined;
          return nurse
            ? signIn(nurse)
            : fail(401, 'REFRESH_INVALID', 'Your session has ended. Please sign in again.');
        }),

      logout: () =>
        respond(() => {
          state.session = null;
        }),
    },

    nurse: {
      getProfile: () => respond(() => current().profile),

      updateProfile: (raw) =>
        respond(() => {
          const nurse = current();
          const p = nurse.profile;
          const body = validateProfileBody(raw);
          const touched = LICENCE_FIELDS.filter((f) => f in body);
          if (touched.length && isLocked(p)) {
            fail(
              409,
              'CONFLICT',
              p.verificationStatus === 'approved'
                ? 'Your licence details are verified and cannot be changed here. Contact support.'
                : 'Your licence details are being reviewed. You can change them if the review asks you to.',
              { field: touched[0] },
            );
          }
          if (body.licenceNumber !== undefined) {
            const taken = Object.values(state.nurses).some(
              (n) => n.user.id !== nurse.user.id && n.profile.licenceNumber === body.licenceNumber,
            );
            if (taken) {
              fail(409, 'CONFLICT', 'This licence number is already registered.', {
                field: 'licenceNumber',
              });
            }
          }
          const setsRoleFirstTime = body.role !== undefined && p.topics.length === 0;
          const { guidanceNotDiagnosisAccepted, bio, ...rest } = body;
          Object.assign(p, rest);
          if (bio !== undefined) p.bio = bio.trim() || null;
          if (guidanceNotDiagnosisAccepted !== undefined) {
            p.guidanceNotDiagnosisAccepted = guidanceNotDiagnosisAccepted;
          }
          if (body.fullName !== undefined) nurse.user.displayName = body.fullName;
          if (setsRoleFirstTime) p.topics = [...DEFAULT_TOPICS_BY_ROLE[body.role!]];
          return p;
        }),

      updatePreferences: (body) =>
        respond(() => {
          const p = current().profile;
          if (body.topics !== undefined) {
            if (body.topics.length === 0) {
              fail(400, 'TOPICS_REQUIRED', 'Choose at least one topic you answer.', {
                field: 'topics',
              });
            }
            if (new Set(body.topics).size !== body.topics.length) {
              invalid('topics', 'Topics has duplicates.');
            }
            // Keep the server's sort order.
            p.topics = QUESTION_CATEGORIES.filter((t) => body.topics!.includes(t));
          }
          if (body.available !== undefined) p.available = body.available;
          return p;
        }),

      uploadDocument: (type: NurseDocumentType, file: File) =>
        respond(async () => {
          const p = current().profile;
          if (!NURSE_DOCUMENT_TYPES.includes(type)) {
            invalid('type', `type must be one of: ${NURSE_DOCUMENT_TYPES.join(', ')}`);
          }
          if (file.size > NURSE_DOCUMENT_UPLOAD.maxBytes) {
            fail(413, 'VALIDATION_FAILED', 'Files can be up to 10 MB.', { field: 'file' });
          }
          if (isLocked(p)) {
            fail(
              409,
              'CONFLICT',
              'Documents cannot be changed while under review or after approval.',
            );
          }
          const mimeType = await detectDocumentType(file);
          if (!mimeType) {
            invalid('file', 'Upload a PDF or a photo (JPEG, PNG, WebP or HEIC).');
          }
          const doc: NurseDocument = {
            id: `doc_${type}_${Date.now().toString(36)}`,
            type,
            fileName: file.name.slice(0, 120) || type,
            mimeType: mimeType!,
            sizeBytes: file.size,
            uploadedAt: iso(),
          };
          p.documents = [...p.documents.filter((d) => d.type !== type), doc].sort((a, b) =>
            a.type.localeCompare(b.type),
          );
          return doc;
        }),

      removeDocument: (documentId) =>
        respond(() => {
          const p = current().profile;
          if (!p.documents.some((d) => d.id === documentId)) {
            fail(404, 'NOT_FOUND', 'Document not found.');
          }
          if (isLocked(p)) {
            fail(
              409,
              'CONFLICT',
              'Documents cannot be changed while under review or after approval.',
            );
          }
          p.documents = p.documents.filter((d) => d.id !== documentId);
        }),

      submit: () =>
        respond(() => {
          const p = current().profile;
          if (p.verificationStatus === 'pending_review') return p;
          if (p.verificationStatus === 'approved')
            fail(409, 'CONFLICT', 'You are already verified.');
          const missing = missingForSubmit(p);
          if (missing.length) {
            fail(409, 'ONBOARDING_INCOMPLETE', 'Finish every step before submitting.', { missing });
          }
          p.verificationStatus = 'pending_review';
          p.rejectionReason = null;
          return p;
        }),
    },

    mockAdmin: {
      approve: () =>
        respond(() => {
          const p = current().profile;
          p.verificationStatus = 'approved';
          p.rejectionReason = null;
        }),
      reject: (reason) =>
        respond(() => {
          const p = current().profile;
          p.verificationStatus = 'rejected';
          p.rejectionReason = reason;
        }),
    },
  };
}
