import type {
  AgentTokenSummary,
  AnswerResponse,
  AuthTokensResponse,
  CollectAnswerBody,
  CreateAgentTokenBody,
  CreateAgentTokenResponse,
  ChatRequestBody,
  ChatResponse,
  Conversation,
  ConversationSummary,
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
 * sessions list, step-up.
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
   * The assistant (contract §7). Every call sends the thread she sees; POST /chat also saves
   * her message and the reply to her account (a conversation), listed in History.
   */
  chat: {
    /**
     * POST /chat. The last turn is her new message; `conversationId` adds to a saved chat.
     * May return an EmergencyResponse. Both carry the conversationId it was saved in.
     */
    send(body: ChatRequestBody): Promise<ChatResponse>;
    /** GET /chat/conversations. Her saved chats, most recently active first. */
    listConversations(query?: PageQuery): Promise<Page<ConversationSummary>>;
    /** GET /chat/conversations/:id. One chat's messages, oldest first. */
    getConversation(id: Id): Promise<Conversation>;
    /** DELETE /chat/conversations/:id. Deletes the chat and its messages. */
    deleteConversation(id: Id): Promise<void>;
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
     * `approvedAboveLimit` once she approved paying above her per-answer limit (409 otherwise).
     */
    collectAnswer(id: Id, body?: CollectAnswerBody): Promise<AnswerResponse>;
    /** POST /questions/:id/feedback. Helpful / not helpful; sending again changes it. */
    submitFeedback(id: Id, body: FeedbackBody): Promise<FeedbackResponse>;
  };

  /**
   * Claude connections (contract §2, Z12): agent tokens Claude uses through apps/mcp.
   * Signed-in session only; the token is shown once, at creation.
   */
  agentTokens: {
    /** GET /auth/agent-tokens. Active connections, newest first. Never the token. */
    list(): Promise<AgentTokenSummary[]>;
    /** POST /auth/agent-tokens. 409 CONFLICT when she already has MAX_AGENT_TOKENS. */
    create(body: CreateAgentTokenBody): Promise<CreateAgentTokenResponse>;
    /** DELETE /auth/agent-tokens/:id. Immediate: Claude's next call is refused. */
    revoke(id: Id): Promise<void>;
  };

  emergency: {
    /** GET /emergency. Public: works without signing in. */
    get(): Promise<EmergencyResponse>;
  };
}
