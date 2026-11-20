import type {
  AnswerResponse,
  AuthTokensResponse,
  Conversation,
  CreateQuestionBody,
  CreateQuestionResponse,
  CreateTopupBody,
  CreateTopupResponse,
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
  SendMessageBody,
  SendMessageResponse,
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

  chat: {
    /** POST /chat/conversations */
    createConversation(): Promise<Conversation>;
    /** GET /chat/conversations (each item carries its last message only) */
    listConversations(query?: PageQuery): Promise<Page<Conversation>>;
    /** GET /chat/conversations/:id */
    getConversation(id: Id): Promise<Conversation>;
    /** POST /chat/conversations/:id/messages. May return an EmergencyResponse instead of a reply. */
    sendMessage(conversationId: Id, body: SendMessageBody): Promise<SendMessageResponse>;
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
    /** POST /me/questions/:id/collect. Pays (or uses a free answer) and returns the nurse's answer. */
    collectAnswer(id: Id): Promise<AnswerResponse>;
    /** POST /questions/:id/feedback. Helpful / not helpful; sending again changes it. */
    submitFeedback(id: Id, body: FeedbackBody): Promise<FeedbackResponse>;
  };

  emergency: {
    /** GET /emergency. Public: works without signing in. */
    get(): Promise<EmergencyResponse>;
  };
}
