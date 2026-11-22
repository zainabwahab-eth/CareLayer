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

// GET /nurse/earnings
export interface EarningsResponse {
  balance: Money;
  totalEarned: Money;
  answersCount: number;
  recent: EarningEntry[];
}

export interface EarningEntry {
  questionId: Id;
  category: QuestionCategory;
  /** The nurse's 80% share. */
  amount: Money;
  paidFromTreasury: boolean;
  stellarTxHash: string | null;
  earnedAt: IsoDateTime;
}

// POST /nurse/withdrawals  (requires a fresh code)
export interface CreateWithdrawalBody {
  amountKobo: number;
  /** Bank withdrawals are "coming soon". */
  destination: { kind: 'stellar'; address: string };
}

export type WithdrawalStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

export interface Withdrawal {
  id: Id;
  status: WithdrawalStatus;
  amount: Money;
  destinationAddress: string;
  stellarTxHash: string | null;
  createdAt: IsoDateTime;
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
