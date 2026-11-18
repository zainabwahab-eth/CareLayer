import type {
  AnswerResponse,
  AuthTokensResponse,
  Conversation,
  CreateQuestionBody,
  CreateQuestionResponse,
  EmergencyResponse,
  GoogleAuthBody,
  Id,
  MyQuestion,
  Page,
  PageQuery,
  QuestionStatusResponse,
  RequestCodeBody,
  RequestCodeResponse,
  SendMessageBody,
  SendMessageResponse,
  UpdateMeBody,
  UpdateSettingsBody,
  User,
  UserSettings,
  VerifyCodeBody,
  WalletResponse,
  WalletTransaction,
} from '@carelayer/shared';

/*
 * The women's app's view of the CareLayer API (docs/API_CONTRACT.md v0).
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
 * sessions list, logout-all, step-up, agent tokens, top-ups.
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
  };

  wallet: {
    /** GET /wallet */
    get(): Promise<WalletResponse>;
    /** GET /wallet/transactions */
    listTransactions(query?: PageQuery): Promise<Page<WalletTransaction>>;
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

  questions: {
    /** POST /questions. May return an EmergencyResponse instead of a question. */
    create(body: CreateQuestionBody): Promise<CreateQuestionResponse>;
    /** GET /questions/:id/status */
    getStatus(id: Id): Promise<QuestionStatusResponse>;
    /** GET /me/questions */
    listMine(query?: PageQuery): Promise<Page<MyQuestion>>;
    /** GET /me/questions/:id */
    getMine(id: Id): Promise<MyQuestion>;
    /** POST /me/questions/:id/collect. Pays (or uses a free answer) and returns the health worker's answer. */
    collectAnswer(id: Id): Promise<AnswerResponse>;
  };

  emergency: {
    /** GET /emergency. Public: works without signing in. */
    get(): Promise<EmergencyResponse>;
  };
}
