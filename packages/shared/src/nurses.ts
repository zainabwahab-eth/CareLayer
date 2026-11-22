// Nurses and midwives: public profiles, onboarding, verification, earnings, withdrawals.
// See docs/API_CONTRACT.md §9-12. (Renamed from `workers` in contract v1. No doctors.)
import type { Id, IsoDateTime, Money } from './common.js';
import type { QuestionCategory } from './questions.js';

export type NurseRole = 'nurse' | 'midwife';

/** Every nurse and midwife is registered with the Nursing and Midwifery Council of Nigeria. */
export const NURSE_REGULATOR = 'NMCN' as const;

/** "Topics I answer" defaults. Midwives: Pregnancy + Periods. Nurses: all. */
export const DEFAULT_TOPICS_BY_ROLE: Record<NurseRole, QuestionCategory[]> = {
  midwife: ['pregnancy', 'periods'],
  nurse: ['pregnancy', 'periods', 'contraception', 'sexual_health', 'general'],
};

/** Optional. Used by the "Only female health workers" filter (`femaleOnly`). */
export type Gender = 'female' | 'male' | 'prefer_not_to_say';

export const NURSE_LANGUAGES = ['english', 'pidgin', 'yoruba', 'hausa', 'igbo'] as const;
export type NurseLanguage = (typeof NURSE_LANGUAGES)[number];

export const NURSE_BIO_MAX_LENGTH = 280;

export type VerificationStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

export const NURSE_DOCUMENT_TYPES = [
  'practising_licence',
  'registration_certificate',
  'government_id',
  'selfie_with_id',
] as const;
export type NurseDocumentType = (typeof NURSE_DOCUMENT_TYPES)[number];

/** Upload rules for POST /nurse/documents. The type is detected from the file's bytes. */
export const NURSE_DOCUMENT_UPLOAD = {
  maxBytes: 10 * 1024 * 1024,
  /** Detected from content, not from the file name or the browser's claim. */
  allowedTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'],
} as const;

/** Everything POST /nurse/profile/submit checks. `details.missing` lists the ones not done. */
export const ONBOARDING_REQUIREMENTS = [
  'role',
  'fullNameConfirmed',
  'yearsOfPractice',
  'licenceNumber',
  'guidanceNotDiagnosisAccepted',
  ...NURSE_DOCUMENT_TYPES,
] as const;
export type OnboardingRequirement = (typeof ONBOARDING_REQUIREMENTS)[number];

export interface NurseDocument {
  id: Id;
  type: NurseDocumentType;
  fileName: string;
  /** Detected type, one of NURSE_DOCUMENT_UPLOAD.allowedTypes. */
  mimeType: string;
  sizeBytes: number;
  uploadedAt: IsoDateTime;
}

/** Rating shown as "% helpful + count", e.g. "96% helpful (212)". No stars. */
export interface HelpfulRating {
  /** 0-100, rounded. Null until the first feedback. */
  percent: number | null;
  count: number;
}

/**
 * What women see on "Choose who answers" (W08). Never contact details, email or licence number.
 * GET /nurses?topic=&femaleOnly=
 */
export interface NursePublicProfile {
  id: Id;
  /** Full name as on licence. */
  fullName: string;
  role: NurseRole;
  gender: Gender | null;
  yearsOfPractice: number;
  bio: string | null;
  languages: NurseLanguage[];
  topics: QuestionCategory[];
  available: boolean;
  verified: true;
  /** Average time from question to answer, in minutes. Null until the first answer. */
  avgResponseMinutes: number | null;
  helpful: HelpfulRating;
}

export interface NurseListQuery {
  topic?: QuestionCategory;
  femaleOnly?: boolean;
}

/** The nurse's own profile (nurse app). */
export interface NurseProfile {
  userId: Id;
  role: NurseRole | null;
  fullName: string;
  fullNameConfirmed: boolean;
  gender: Gender | null;
  practiceArea: string | null;
  yearsOfPractice: number | null;
  bio: string | null;
  languages: NurseLanguage[];
  licenceNumber: string | null;
  documents: NurseDocument[];
  /** Auto-created custodial wallet. */
  custodialStellarAddress: string;
  /** Optional own Stellar address for payouts. */
  ownStellarAddress: string | null;
  guidanceNotDiagnosisAccepted: boolean;
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
  topics: QuestionCategory[];
  available: boolean;
  avgResponseMinutes: number | null;
  helpful: HelpfulRating;
}

// PATCH /nurse/profile
export interface UpdateNurseProfileBody {
  /** Full name exactly as on the licence (also her display name). Locked once submitted. */
  fullName?: string;
  /** Locked once submitted. */
  role?: NurseRole;
  fullNameConfirmed?: boolean;
  gender?: Gender | null;
  practiceArea?: string;
  yearsOfPractice?: number;
  /** Max NURSE_BIO_MAX_LENGTH characters. */
  bio?: string;
  languages?: NurseLanguage[];
  /** Locked once submitted. Unique across nurses. */
  licenceNumber?: string;
  guidanceNotDiagnosisAccepted?: boolean;
}

/** Locked while the profile is pending review or approved (the admin checked these). */
export const LICENCE_FIELDS = ['fullName', 'role', 'licenceNumber', 'fullNameConfirmed'] as const;

// PATCH /nurse/preferences
export interface UpdateNursePreferencesBody {
  /** At least one. */
  topics?: QuestionCategory[];
  available?: boolean;
}

// PUT /nurse/payout-address  (requires a fresh code)
export interface UpdatePayoutAddressBody {
  /** null = pay out to the custodial wallet. */
  stellarAddress: string | null;
}

// GET /nurse/earnings  (N09). Days and weeks are Lagos time; weeks start on Monday.
export interface EarningsResponse {
  /** "Available to withdraw": USDC in her CareLayer wallet, minus withdrawals still in progress. */
  available: Money;
  /** USDC in her CareLayer wallet as last read from Stellar. */
  balance: Money;
  /** When `balance` was read. Older than the request = Stellar was slow; last known value. */
  balanceSyncedAt: IsoDateTime | null;
  /** Her CareLayer wallet (custodial). */
  stellarAddress: string;
  /** Her own payout address, if she set one: payouts then go there, not to `stellarAddress`. */
  payoutAddress: string | null;
  /** All time: the nurse's 80% of every collected answer (free ones included). */
  totalEarned: Money;
  answersCount: number;
  thisWeek: EarningsPeriod & {
    /** Monday to Sunday, always 7 entries (the N09 chart). */
    days: EarningsDay[];
  };
  thisMonth: EarningsPeriod;
  /** Latest 10 money movements, newest first (N09 "Recent payments"). "See all": GET /wallet/transactions. */
  recent: EarningsActivity[];
}

export interface EarningsPeriod {
  /** First day of the period, YYYY-MM-DD (Lagos). */
  from: string;
  total: Money;
  answersCount: number;
}

export interface EarningsDay {
  /** YYYY-MM-DD (Lagos). */
  date: string;
  weekday: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  total: Money;
  answersCount: number;
  isToday: boolean;
}

export type EarningsActivity = EarningEntry | WithdrawalEntry;

/** One answer's 80% share. */
export interface EarningEntry {
  kind: 'earning';
  id: Id;
  questionId: Id;
  category: QuestionCategory;
  /** Short label for the list (start of the question she answered), e.g. "Swollen feet at 24 weeks…". */
  title: string;
  amount: Money;
  paidFromTreasury: boolean;
  /** pending = being sent to her wallet (retried automatically). */
  status: 'pending' | 'confirmed';
  stellarTxHash: string | null;
  earnedAt: IsoDateTime;
}

export interface WithdrawalEntry {
  kind: 'withdrawal';
  id: Id;
  /** Negative (money out), on both fields. */
  amount: Money;
  destinationAddress: string;
  status: WithdrawalStatus;
  stellarTxHash: string | null;
  createdAt: IsoDateTime;
}

/** Smallest withdrawal: ₦100. */
export const MIN_WITHDRAWAL_KOBO = 10_000;

// POST /nurse/withdrawals  (requires a fresh code)
export interface CreateWithdrawalBody {
  amountKobo: number;
  /** Bank withdrawals are "coming soon". */
  destination: { kind: 'stellar'; address: string };
}

export type WithdrawalStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

export interface Withdrawal {
  id: Id;
  /**
   * confirmed = on Stellar (`stellarTxHash`). submitted = sent, outcome not known yet (Stellar was
   * slow): it settles to confirmed or failed within about a minute; poll GET /nurse/withdrawals.
   * failed = nothing left her wallet (`failureReason`).
   */
  status: WithdrawalStatus;
  amount: Money;
  destinationAddress: string;
  stellarTxHash: string | null;
  failureReason: string | null;
  createdAt: IsoDateTime;
  confirmedAt: IsoDateTime | null;
}

// Admin views

export interface AdminNurseSummary {
  userId: Id;
  fullName: string;
  role: NurseRole | null;
  licenceNumber: string | null;
  verificationStatus: VerificationStatus;
  submittedAt: IsoDateTime | null;
}

export interface AdminNurseDetail extends NurseProfile {
  email: string;
  /** Short-lived signed URLs to view each uploaded document. */
  documentUrls: Record<Id, string>;
}

// POST /admin/nurses/:id/reject
export interface RejectNurseBody {
  reason: string;
}
