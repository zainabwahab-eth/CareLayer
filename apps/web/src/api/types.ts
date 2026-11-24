import type {
  AnswerResponse,
  AuthTokensResponse,
  ChatRequestBody,
  ChatResponse,
  CollectAnswerBody,
  CreateQuestionBody,
  CreateQuestionResponse,
  CreateTopupBody,
  CreateTopupResponse,
  DraftRequestBody,
  DraftResponse,
  EmergencyResponse,
  FeedbackBody,
  FeedbackResponse,
  GoogleAuthBody,
  Id,
  MyQuestion,
  NotificationPreferences,
  NurseListQuery,
  NursePublicProfile,
  Page,
  PageQuery,
  QuestionStatus,
  QuestionStatusResponse,
  RequestCodeBody,
  RequestCodeResponse,
  Topup,
  UpdateMeBody,
  UpdateNotificationPreferencesBody,
  UpdateSettingsBody,
  User,
  UserSettings,
  VerifyCodeBody,
  WalletResponse,
  WalletTransaction,
} from '@carelayer/shared';

/** GET /me/questions query: `?status=` + PageQuery (contract §8.4). */
export type MyQuestionsQuery = PageQuery & { status?: QuestionStatus };

/*
 * The women's app's view of the CareLayer API (docs/API_CONTRACT.md v1).
 *
 * UI code depends only on this interface, never on how it is implemented.
 * Two implementations exist:
 *   - mock/  in-browser mock with sample data (VITE_USE_MOCK_API=true)
 *   - http/  fetch client for apps/api
 * Every request and response type comes from @carelayer/shared. Do not
 * redefine contract types here; add them to packages/shared instead.
 *
 * Every method rejects with `ApiError` (see errors.ts) on failure.
 *
 * Not covered yet (no women's screen needs them in this milestone):
 * sessions list, step-up, agent tokens.
 */
export interface CareLayerApi {
  /** Which implementation is active. Use only for diagnostics, never for UI logic. */
  readonly mode: 'mock' | 'http';

  auth: {
    /** POST /auth/code/request */
    requestCode(body: RequestCodeBody): Promise<RequestCodeResponse>;
    /** POST /auth/code/verify */
    verifyCode(body: VerifyCodeBody): Promise<AuthTokensResponse>;
    /** POST /auth/google */
    signInWithGoogle(body: GoogleAuthBody): Promise<AuthTokensResponse>;
    /** POST /auth/refresh. Restores the session from the refresh cookie. */
    refresh(): Promise<AuthTokensResponse>;
    /** POST /auth/logout */
    logout(): Promise<void>;
    /** POST /auth/logout-all. Revokes every session, including this one. */
    logoutAll(): Promise<void>;
  };

  me: {
    /** GET /me */
    get(): Promise<User>;
    /** PATCH /me */
    update(body: UpdateMeBody): Promise<User>;
    /** GET /me/settings */
    getSettings(): Promise<UserSettings>;
    /** PATCH /me/settings */
    updateSettings(body: UpdateSettingsBody): Promise<UserSettings>;
    /** GET /me/notifications (email only) */
    getNotifications(): Promise<NotificationPreferences>;
    /** PATCH /me/notifications */
    updateNotifications(body: UpdateNotificationPreferencesBody): Promise<NotificationPreferences>;
  };

  wallet: {
    /** GET /wallet */
    get(): Promise<WalletResponse>;
    /** GET /wallet/transactions */
    listTransactions(query?: PageQuery): Promise<Page<WalletTransaction>>;
  };

  topups: {
    /** POST /topups. Returns the Paystack TEST checkout URL to send her to. */
    create(body: CreateTopupBody): Promise<CreateTopupResponse>;
    /** GET /topups/:id. Poll after Paystack sends her back, until credited or failed. */
    get(id: Id): Promise<Topup>;
  };

  /**
   * The assistant (contract §7). Stateless: nothing about the chat is stored on the
   * server, so every call sends the thread so far (the client keeps it in memory).
   */
  chat: {
    /** POST /chat. The last turn is her new message. May return an EmergencyResponse. */
    send(body: ChatRequestBody): Promise<ChatResponse>;
    /**
     * POST /chat/draft. Exactly what a nurse would receive (W07), a signed `draftToken`
     * for POST /questions, and the price offer. May return an EmergencyResponse.
     */
    draft(body: DraftRequestBody): Promise<DraftResponse>;
  };

  nurses: {
    /** GET /nurses. Approved, available nurses for W08 "Choose who answers". */
    list(query?: NurseListQuery): Promise<NursePublicProfile[]>;
  };

  questions: {
    /** POST /questions. May return an EmergencyResponse instead of a question. */
    create(body: CreateQuestionBody): Promise<CreateQuestionResponse>;
    /** GET /questions/:id/status */
    getStatus(id: Id): Promise<QuestionStatusResponse>;
    /** GET /me/questions */
    listMine(query?: MyQuestionsQuery): Promise<Page<MyQuestion>>;
    /** GET /me/questions/:id */
    getMine(id: Id): Promise<MyQuestion>;
    /**
     * POST /me/questions/:id/collect. Pays (or uses a free answer) and returns the nurse's answer.
     * The API's own agent pays over x402 from her custodial wallet; the client never pays itself.
     * Calling it again for a collected answer returns the same answer and receipt, never a second
     * charge (contract §8.3 step 3). Pass `approvedAboveLimit` only after she approved a price above
     * her limit (409 SPENDING_LIMIT_EXCEEDED).
     */
    collectAnswer(id: Id, body?: CollectAnswerBody): Promise<AnswerResponse>;
    /** POST /questions/:id/feedback. Helpful / not helpful; sending again changes it. */
    submitFeedback(id: Id, body: FeedbackBody): Promise<FeedbackResponse>;
  };

  emergency: {
    /** GET /emergency. Public: works without signing in. */
    get(): Promise<EmergencyResponse>;
  };
}
