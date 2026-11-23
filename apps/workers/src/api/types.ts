import type {
  Answer,
  AuthTokensResponse,
  Claim,
  CreateWithdrawalBody,
  EarningsResponse,
  GoogleAuthBody,
  Id,
  NurseDashboard,
  NurseDocument,
  NurseDocumentType,
  NurseProfile,
  NurseQuestionTab,
  NurseQuestionView,
  Page,
  PageQuery,
  RequestCodeBody,
  RequestCodeResponse,
  SessionInfo,
  StepUpBody,
  StepUpResponse,
  SubmitAnswerBody,
  UpdateNursePreferencesBody,
  UpdateNurseProfileBody,
  UpdatePayoutAddressBody,
  UpdateSettingsBody,
  UserSettings,
  VerifyCodeBody,
  WalletTransaction,
  Withdrawal,
} from '@carelayer/shared';

/*
 * The nurse app's view of the CareLayer API (docs/API_CONTRACT.md §2, §3, §4, §9, §10, §12).
 * Screens depend only on this interface. Two implementations, as in apps/web:
 *   - mock-api.ts  in-browser mock (VITE_USE_MOCK_API=true)
 *   - http-api.ts  fetch client for apps/api
 * Every type comes from @carelayer/shared. Every method rejects with ApiError.
 * Each method names the apps/api route it calls; none is invented (docs/QUESTIONS.md Q6).
 */
export interface NurseApi {
  readonly mode: 'mock' | 'http';

  auth: {
    /** POST /auth/code/request (app "nurses"). purpose "step_up" sends the bearer token. */
    requestCode(body: RequestCodeBody): Promise<RequestCodeResponse>;
    /** POST /auth/code/verify */
    verifyCode(body: VerifyCodeBody): Promise<AuthTokensResponse>;
    /** POST /auth/google */
    signInWithGoogle(body: GoogleAuthBody): Promise<AuthTokensResponse>;
    /** POST /auth/refresh: restores the session from the refresh cookie. */
    refresh(): Promise<AuthTokensResponse>;
    /** POST /auth/logout */
    logout(): Promise<void>;
    /** POST /auth/logout-all: ends every session, this one included. */
    logoutAll(): Promise<void>;
    /** POST /auth/step-up: this session may withdraw or change the payout wallet for 5 minutes. */
    stepUp(body: StepUpBody): Promise<StepUpResponse>;
    /** GET /auth/sessions */
    listSessions(): Promise<SessionInfo[]>;
    /** DELETE /auth/sessions/:id */
    revokeSession(id: Id): Promise<void>;
  };

  me: {
    /** GET /me/settings */
    getSettings(): Promise<UserSettings>;
    /** PATCH /me/settings. Nurses may change `appearance` only. */
    updateSettings(body: Pick<UpdateSettingsBody, 'appearance'>): Promise<UserSettings>;
  };

  nurse: {
    /** GET /nurse/profile */
    getProfile(): Promise<NurseProfile>;
    /** PATCH /nurse/profile */
    updateProfile(body: UpdateNurseProfileBody): Promise<NurseProfile>;
    /** PATCH /nurse/preferences (topics, available) */
    updatePreferences(body: UpdateNursePreferencesBody): Promise<NurseProfile>;
    /** POST /nurse/documents (multipart: type, file). Re-uploading a type replaces it. */
    uploadDocument(type: NurseDocumentType, file: File): Promise<NurseDocument>;
    /** DELETE /nurse/documents/:id */
    removeDocument(id: Id): Promise<void>;
    /** POST /nurse/profile/submit: send for review. */
    submit(): Promise<NurseProfile>;
    /** PUT /nurse/payout-address (needs a fresh code: auth.stepUp). null = her CareLayer wallet. */
    setPayoutAddress(body: UpdatePayoutAddressBody): Promise<NurseProfile>;
  };

  /** Claiming and answering (contract §9). All but dashboard need an approved nurse. */
  cases: {
    /** GET /nurse/dashboard (any verification status) */
    dashboard(): Promise<NurseDashboard>;
    /** GET /nurse/questions?tab= */
    list(tab: NurseQuestionTab, query?: PageQuery): Promise<Page<NurseQuestionView>>;
    /** GET /nurse/questions/:id */
    get(id: Id): Promise<NurseQuestionView>;
    /** GET /nurse/claim: her current claim, or null */
    current(): Promise<NurseQuestionView | null>;
    /** POST /nurse/questions/:id/claim: 10-minute lock */
    claim(id: Id): Promise<Claim>;
    /** POST /nurse/questions/:id/release */
    release(id: Id): Promise<void>;
    /** POST /nurse/questions/:id/answer */
    answer(id: Id, body: SubmitAnswerBody): Promise<Answer>;
  };

  /** Earnings and withdrawals (contract §12): any signed-in nurse. */
  earnings: {
    /** GET /nurse/earnings */
    get(): Promise<EarningsResponse>;
    /** GET /nurse/withdrawals */
    listWithdrawals(query?: PageQuery): Promise<Page<Withdrawal>>;
    /** POST /nurse/withdrawals (needs a fresh code: auth.stepUp) */
    withdraw(body: CreateWithdrawalBody): Promise<Withdrawal>;
    /** GET /wallet/transactions: confirmed earnings (+) and withdrawals (−) */
    listTransactions(query?: PageQuery): Promise<Page<WalletTransaction>>;
  };

  /**
   * Mock builds only: stand-in for the admin's decision (GET /admin-console in
   * the real API), so N04's approved and rejected states can be tried.
   */
  readonly mockAdmin?: {
    approve(): Promise<void>;
    reject(reason: string): Promise<void>;
  };
}
