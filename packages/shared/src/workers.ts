// Health worker onboarding, verification, earnings, withdrawals. See docs/API_CONTRACT.md §10-12.
import type { Id, IsoDateTime, Money } from './common.js';
import type { QuestionCategory } from './questions.js';

export type WorkerRole = 'nurse' | 'midwife' | 'doctor';

/** NMCN for nurses and midwives, MDCN for doctors. Derived from role. */
export type Regulator = 'NMCN' | 'MDCN';

export const REGULATOR_BY_ROLE: Record<WorkerRole, Regulator> = {
  nurse: 'NMCN',
  midwife: 'NMCN',
  doctor: 'MDCN',
};

export const DEFAULT_TOPICS_BY_ROLE: Record<WorkerRole, QuestionCategory[]> = {
  midwife: ['pregnancy', 'periods'],
  nurse: ['pregnancy', 'periods', 'contraception', 'sexual_health', 'general'],
  doctor: ['pregnancy', 'periods', 'contraception', 'sexual_health', 'general'],
};

/**
 * OPEN QUESTION (v0): onboarding in the brief does not collect gender, but women can
 * "prefer a female health worker". Needed to honour that preference.
 */
export type WorkerGender = 'female' | 'male' | 'prefer_not_to_say';

export type VerificationStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

export type WorkerDocumentType =
  'practising_licence' | 'registration_certificate' | 'government_id' | 'selfie_with_id';

export interface WorkerDocument {
  id: Id;
  type: WorkerDocumentType;
  fileName: string;
  uploadedAt: IsoDateTime;
}

export interface WorkerProfile {
  userId: Id;
  role: WorkerRole | null;
  fullName: string;
  fullNameConfirmed: boolean;
  gender: WorkerGender | null;
  practiceArea: string | null;
  yearsOfPractice: number | null;
  licenceNumber: string | null;
  regulator: Regulator | null;
  documents: WorkerDocument[];
  /** Auto-created custodial wallet. */
  custodialStellarAddress: string;
  /** Optional own Stellar address for payouts. */
  ownStellarAddress: string | null;
  guidanceNotDiagnosisAccepted: boolean;
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
  topics: QuestionCategory[];
  available: boolean;
}

// PUT /worker/profile
export interface UpdateWorkerProfileBody {
  role?: WorkerRole;
  fullNameConfirmed?: boolean;
  gender?: WorkerGender;
  practiceArea?: string;
  yearsOfPractice?: number;
  licenceNumber?: string;
  guidanceNotDiagnosisAccepted?: boolean;
}

// PATCH /worker/preferences
export interface UpdateWorkerPreferencesBody {
  /** At least one. */
  topics?: QuestionCategory[];
  available?: boolean;
}

// PUT /worker/payout-address  (requires X-Step-Up-Token)
export interface UpdatePayoutAddressBody {
  /** null = pay out to the custodial wallet. */
  stellarAddress: string | null;
}

// GET /worker/earnings
export interface EarningsResponse {
  balance: Money;
  totalEarned: Money;
  answersCount: number;
  recent: EarningEntry[];
}

export interface EarningEntry {
  questionId: Id;
  category: QuestionCategory;
  /** The worker's 80% share. */
  amount: Money;
  paidFromTreasury: boolean;
  stellarTxHash: string | null;
  earnedAt: IsoDateTime;
}

// POST /worker/withdrawals  (requires X-Step-Up-Token)
export interface CreateWithdrawalBody {
  amountKobo: number;
  /** Defaults to ownStellarAddress. Bank withdrawals are "coming soon". */
  destination: { kind: 'stellar'; address: string };
}

export type WithdrawalStatus = 'submitted' | 'confirmed' | 'failed';

export interface Withdrawal {
  id: Id;
  status: WithdrawalStatus;
  amount: Money;
  destinationAddress: string;
  stellarTxHash: string | null;
  createdAt: IsoDateTime;
}

// Admin views

export interface AdminWorkerSummary {
  userId: Id;
  fullName: string;
  role: WorkerRole | null;
  regulator: Regulator | null;
  licenceNumber: string | null;
  verificationStatus: VerificationStatus;
  submittedAt: IsoDateTime | null;
}

export interface AdminWorkerDetail extends WorkerProfile {
  email: string;
  /** Short-lived signed URLs to view each uploaded document. */
  documentUrls: Record<Id, string>;
}

// POST /admin/workers/:id/reject
export interface RejectWorkerBody {
  reason: string;
}
