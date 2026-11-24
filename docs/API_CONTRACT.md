# CareLayer API Contract

> **v1 draft (Z1).** Aligned with the database schema and the decisions log in `docs/TASKS.md` §2. Hikmah reviews it in the Z1 PR; after sign-off, any change is a contract change: update this file **and** `packages/shared` in the same commit, and tell the other person.

Every type named here is exported from `@carelayer/shared` (`packages/shared/src`). If this doc and the types disagree, that is a bug: fix both.

## Changes from v0

**Renamed (`worker` → `nurse`). Hikmah: update mocks and imports.**

| v0                                          | v1                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `UserRole` `'worker'`                       | `'nurse'`                                                                        |
| `AppAudience` `'workers'`                   | `'nurses'`; `AUTH_RULES.refreshTtlDays.nurses`                                   |
| `WorkerRole` (`nurse \| midwife \| doctor`) | `NurseRole` (`nurse \| midwife`). No doctors.                                    |
| `Regulator`, `REGULATOR_BY_ROLE`            | `NURSE_REGULATOR = 'NMCN'` (no MDCN)                                             |
| `WorkerGender`                              | `Gender`                                                                         |
| `WorkerProfile`                             | `NurseProfile`                                                                   |
| `WorkerDocument`, `WorkerDocumentType`      | `NurseDocument`, `NurseDocumentType`                                             |
| `UpdateWorkerProfileBody`                   | `UpdateNurseProfileBody`                                                         |
| `UpdateWorkerPreferencesBody`               | `UpdateNursePreferencesBody`                                                     |
| `WorkerQuestionView`                        | `NurseQuestionView`                                                              |
| `PublicWorker`, `Answer.worker`             | `PublicNurse` (adds `id`), `Answer.nurse`                                        |
| `AdminWorkerSummary`, `AdminWorkerDetail`   | `AdminNurseSummary`, `AdminNurseDetail`                                          |
| `RejectWorkerBody`                          | `RejectNurseBody`                                                                |
| `PAYOUT_SPLIT.workerBps`                    | `PAYOUT_SPLIT.nurseBps`                                                          |
| error `WORKER_NOT_APPROVED`                 | `NURSE_NOT_APPROVED`                                                             |
| `/worker/*` routes                          | `/nurse/*`                                                                       |
| `/admin/workers/*` routes                   | `/admin/nurses/*`                                                                |
| `PUT /worker/profile`                       | `PATCH /nurse/profile`                                                           |
| `CreateQuestionBody.preferFemaleWorker`     | `femaleOnly` (hard filter on nurse gender)                                       |
| `CreateQuestionBody.conversationId`         | removed (questions are created from a draft token; saved chats are separate, §7) |

**Added:** `QuestionStatus` `expired` and `cancelled`; `CreateQuestionBody.consent`, `nurseSelection`, `chosenNurseId`; `Answer.recommendSeeSomeoneToday`; `GET /nurses` + `NursePublicProfile`; `POST /questions/:id/feedback`; `GET/PATCH /me/notifications`; `NurseQuestionView.ageRange`, `pregnancyWeeks`, `chosenForYou`, `claimsCloseAt`; nurse `bio`, `languages`, `helpful`, `avgResponseMinutes`; `/health` reports the database and returns 503 when it is down; error codes `CONSENT_REQUIRED`, `CHOSEN_NURSE_UNAVAILABLE`, `QUESTION_EXPIRED`, `CLAIMS_CLOSED`.

**Known follow-ups:** the `docs/TASKS.md` screen map uses slightly different names for some routes (`POST /chat`, `PATCH /nurse/availability`, `GET /nurse/dashboard`). Each is reconciled in the task that builds it (Z6, Z7, Z9). Auth (Z3) and wallet (Z4) were reconciled: the contract names stay (`/auth/code/*`, `/wallet`), because `apps/web` already calls them.

**Z6 changes (chat, emergencies, questions). Hikmah: see "For Hikmah" in the Z6 PR.**

- **§7 conversation endpoints are gone. Chat is `POST /chat { messages }`** (the client sends the thread; nothing stored). The response is the same shape as before (`{ kind: "reply", message, escalationOffer } | EmergencyResponse`), now named `ChatResponse`. `Conversation`, `SendMessageBody` and `SendMessageResponse` stay in `@carelayer/shared` as `@deprecated` until `apps/web` switches.
- **New `POST /chat/draft { messages }`** returns the exact question a nurse would receive (`QuestionDraft`), a `draftToken`, and the price `offer`. Used by W07 Consent and "Ask a nurse directly".
- **`CreateQuestionBody.draftToken`** (optional): the question is stored exactly as that draft.
- **Consent must share `cleaned_text` and `category`** (`REQUIRED_SHARED_FIELDS`), else `CONSENT_REQUIRED` with `details.missing`. Fields she does not share are not stored.
- **`GET /me/questions?status=active`** (open or claimed), type `MyQuestionsStatusFilter`.
- **Free answers left counts in-flight free questions** (open, claimed, or answered but not collected), in offers, `POST /questions` and `GET /wallet`. An expired or cancelled question gives its free answer back.
- Added: `ChatTurn`, `ChatRequestBody`, `ChatResponse`, `CHAT_LIMITS`, `QuestionDraft`, `DraftRequestBody`, `DraftResponse`, `REQUIRED_SHARED_FIELDS`, `MyQuestionsStatusFilter`.
- `GET /nurses` and the question endpoints are **woman-only for now**. Agent tokens (Claude) and third-party agents (`X-Question-Key`) come with Z12.
- **Settings (same PR):** **`/me/settings` and `/me/notifications` are built.** **A women-only setting sent by a nurse or admin is now a 400, not silently ignored.** Added `SPENDING_LIMIT_KOBO`, `DEFAULT_USER_SETTINGS` and `WOMEN_ONLY_SETTINGS` to `@carelayer/shared`.

**Z7 changes (claiming and answering):**

- §9 is built.
- **New `GET /nurse/dashboard` → `NurseDashboard`.**
- `NURSE_QUESTION_TABS`, `NurseQuestionTab` and `ANSWER_TEXT_MAX_LENGTH` added.
- **Claim can return 410 `QUESTION_EXPIRED`.** `ACTIVE_CLAIM_EXISTS` carries `details.questionId`.
- **Waiting is not paged** (bounded: only questions under 30 minutes old are open).
- The "answer is ready" email to women is sent when the nurse answers.

**Z12 changes (Claude via MCP). Hikmah: the account screen's "Use CareLayer in Claude" can use the real API.**

- **New `GET /auth/agent-tokens`** (`AgentTokenSummary[]`). `POST` and `DELETE` are built.
  - Session only: an agent token cannot create, list or revoke tokens.
  - Max 5 active (`MAX_AGENT_TOKENS`), and tokens start with `AGENT_TOKEN_PREFIX` (`clat_`).
- **Agent tokens work only on** `POST /chat/draft`, `POST /questions`, `GET /questions/:id/status`, `POST /me/questions/:id/collect` and `GET /wallet`. Every other route answers 403.
- **`POST /questions` takes `source: "mcp"` with an agent token** (and still `"web"` with a session; a mismatch is 400).
- **Claude's spending limit and "ask before each payment" are enforced by the API.**
  - New error **409 `PAYMENT_CONFIRMATION_REQUIRED`** (`details: { price }`).
  - **`CollectAnswerBody` adds `confirmPayment`.**
  - `approvedAboveLimit` is ignored for agent tokens.
- §13 is final.
- `X-Question-Key` (public third-party agents) is still not built.
- Added `AGENT_TOKEN_PREFIX`, `MAX_AGENT_TOKENS` and `AgentTokenSummary` to `@carelayer/shared`.

**Z10 changes (earnings and withdrawals). Hikmah: N09 can use the real API.**

- §12 is built.
- **`EarningsResponse` is reshaped for N09:**
  - Adds `available`, `balanceSyncedAt`, `stellarAddress`, `payoutAddress`, `thisWeek` (with 7 `days` for the chart) and `thisMonth`.
  - `recent` is now `EarningsActivity[]` (earnings and withdrawals, with a `kind` field).
  - **`EarningEntry` adds `kind`, `id`, `title` and `status`.**
- **`Withdrawal` adds `destinationMemo`, `failureReason` and `confirmedAt`.** **`CreateWithdrawalBody.destination` adds an optional `memo: WithdrawalMemo`** (`{ type: "text" | "id", value }`) for exchanges. **`POST /nurse/withdrawals` can return 201 with `status: "submitted"`** (outcome not known yet).
- **New errors on `POST /nurse/withdrawals`:**
  - 409 `CONFLICT` (one withdrawal at a time).
  - 503 `SERVICE_UNAVAILABLE`.
  - 400 `VALIDATION_FAILED` for less than ₦100.
  - `STELLAR_ADDRESS_INVALID` now also covers her own wallet, an address with no account, and an address with no USDC trustline.
- Added `EarningsActivity`, `WithdrawalEntry`, `WithdrawalMemo`, `EarningsPeriod`, `EarningsDay` and `MIN_WITHDRAWAL_KOBO` to `@carelayer/shared`.

**Z8 changes (pay on delivery, payouts, feedback). Hikmah: the ask flow can use the real API.**

- §8.3 and §8.4 collect/feedback are built.
- **`GET /questions/:id/answer` is a manual x402 flow, not `@x402/express`'s `paymentMiddleware`.** The middleware runs the route handler before it settles; the manual flow settles first and only then reads the answer. Wire format is unchanged (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`).
- **New 503 `SERVICE_UNAVAILABLE` on the answer and collect** with `details: AnswerUnavailableDetails` (`retryable`, `paymentPending`, `retryAfterSeconds`). Nothing was charged; show "try again".
- **`POST /me/questions/:id/collect` takes an optional body `CollectAnswerBody { approvedAboveLimit? }`.** A paid answer above her limit is 409 `SPENDING_LIMIT_EXCEEDED` until she approves.
- **`INSUFFICIENT_BALANCE` `details: { price, balance }`** (both `Money`).
- **`GET /questions/:id/answer` and collect are 410 `QUESTION_EXPIRED` for expired questions.**
- Feedback needs a collected answer (409 before).
- `isFree` stays a quote: the final charge is decided on collection (free only if one of her first 3 is still unused).
- Added `CollectAnswerBody` and `AnswerUnavailableDetails` to `@carelayer/shared`.

**Z9 changes (nurse onboarding, admin verification):**

- §10 and §11 are built.
- **`UpdateNurseProfileBody` adds `fullName`.**
- **`NurseDocument` adds `mimeType` and `sizeBytes`.**
- **Licence fields and documents are locked while `pending_review`, not only once `approved`.**
- **Reject is also 409 when the profile is not `pending_review`.**
- New `GET /files/nurse-documents/:id` (signed links) and `GET /admin-console`.
- New error `LINK_EXPIRED` (410).
- Added `NURSE_DOCUMENT_TYPES`, `NURSE_DOCUMENT_UPLOAD`, `ONBOARDING_REQUIREMENTS`, `OnboardingRequirement` and `LICENCE_FIELDS`.
- The TASKS.md screen map's `PATCH /nurse/availability` is `PATCH /nurse/preferences { available }`.

**Z5 changes (top-ups):** **`TopupStatus` adds `"paid"`.** `TOPUP_LIMITS_KOBO` added to `@carelayer/shared`. Route names stay `/topups` (the TASKS.md screen map said `/me/topups`).

**Z4 changes (wallet):** **`WalletResponse` adds `status: "pending"|"active"` and `balanceSyncedAt`** (required). **`WalletTransaction` lists confirmed movements only.** `stellarExplorerUrl()` added to `@carelayer/shared`. Hikmah: `getWallet` in `apps/web/src/api/mock/mock-api.ts` needs the two new fields.

**Z3 changes (auth):** **`POST /auth/step-up` now returns `{ freshUntil }`** (the session is marked fresh; no `X-Step-Up-Token` header). **`AppAudience` adds `"admin"`** (log in only). **`VALIDATION_FAILED` adds `details.field`.** **New error `SERVICE_UNAVAILABLE` (503).** `AUTH_RULES` adds `resendAfterSeconds`, `maxCodesPerHour`, `refreshTtlDays.admin`, `refreshReuseGraceSeconds`. `/auth/logout` accepts the refresh cookie alone. `WRONG_APP` is no longer used (accounts are per app, so a woman's email in the nurse app is `ACCOUNT_NOT_FOUND`).

## 0. Conventions

| Item        | Rule                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL    | `http://localhost:4000` locally (`VITE_API_URL` in the frontends). No `/v1` prefix.                                                                                                                                                                                                                                                                                                                       |
| Format      | JSON in and out (`Content-Type: application/json`), except document uploads (multipart).                                                                                                                                                                                                                                                                                                                  |
| Auth        | `Authorization: Bearer <accessToken>`. Access tokens last ~15 min. The refresh token lives only in an httpOnly cookie.                                                                                                                                                                                                                                                                                    |
| Auth levels | **public**: no token. **woman** / **nurse** / **admin**: signed in with that role. **any**: any signed-in role. **agent**: signed-in woman, or her agent token (`Authorization: Bearer clat_...`, Claude via `apps/mcp`; Z12). An agent token works ONLY on the routes marked "agent" or "+ agent token"; everywhere else it gets 403 `FORBIDDEN`. Public agents with `X-Question-Key` are not built yet. |
| Step-up     | Withdrawals and payout address changes need a code verified on the same session in the last 5 minutes (`POST /auth/step-up`), else 403 `STEP_UP_REQUIRED`.                                                                                                                                                                                                                                                |
| Money       | `Money = { kobo: number, usdc: string }`. `kobo` is integer naira minor units (₦500 = `50000`). `usdc` is a decimal string with 7 places (stroops). Never floats.                                                                                                                                                                                                                                         |
| Price       | ₦500 per answer (`ANSWER_PRICE_KOBO`). Nurse 80% (₦400), platform 20%. Fixed demo rate `NGN_PER_USDC`.                                                                                                                                                                                                                                                                                                    |
| Times       | ISO 8601 UTC strings (`IsoDateTime`).                                                                                                                                                                                                                                                                                                                                                                     |
| Ids         | Opaque strings (`Id`).                                                                                                                                                                                                                                                                                                                                                                                    |
| Lists       | Cursor pages: `?cursor=&limit=` (default 20, max 100) returning `Page<T> = { items, nextCursor }`.                                                                                                                                                                                                                                                                                                        |
| Categories  | `pregnancy`, `periods`, `contraception`, `sexual_health`, `general` (`QuestionCategory`). Set by the AI only.                                                                                                                                                                                                                                                                                             |
| Privacy     | Never in any response to a nurse: the woman's name, email, phone, wallet or location. Never in any response to a woman: a nurse's email, phone or licence number.                                                                                                                                                                                                                                         |

### Errors

Every error returns `ApiErrorBody`:

```json
{
  "error": {
    "code": "CODE_INVALID",
    "message": "That code is not right.",
    "details": { "attemptsRemaining": 3 }
  }
}
```

Unexpected server errors return `500 INTERNAL` with `details.requestId` (also in the `X-Request-Id` response header) and never an internal message or stack trace. Unknown routes return `404 NOT_FOUND`.

| HTTP      | Typical codes                                                                                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400       | `VALIDATION_FAILED` (`message` and `details.field` = the first bad field, `details.issues: { path, message }[]` = all of them), `CODE_INVALID`, `STELLAR_ADDRESS_INVALID`, `TOPICS_REQUIRED`, `CONSENT_REQUIRED`                  |
| 401       | `UNAUTHENTICATED`, `REFRESH_INVALID`, `REFRESH_REUSED`, `GOOGLE_TOKEN_INVALID`                                                                                                                                                    |
| 402       | x402 payment required (see §8.3). Not an `ApiErrorBody`.                                                                                                                                                                          |
| 403       | `FORBIDDEN`, `WRONG_APP`, `STEP_UP_REQUIRED`, `NURSE_NOT_APPROVED`, `NOT_CLAIM_OWNER`                                                                                                                                             |
| 404       | `NOT_FOUND`, `ACCOUNT_NOT_FOUND`                                                                                                                                                                                                  |
| 409       | `CONFLICT`, `ACCOUNT_EXISTS`, `QUESTION_NOT_ANSWERED`, `QUESTION_ALREADY_CLAIMED`, `ACTIVE_CLAIM_EXISTS`, `SPENDING_LIMIT_EXCEEDED`, `INSUFFICIENT_BALANCE`, `ONBOARDING_INCOMPLETE`, `CHOSEN_NURSE_UNAVAILABLE`, `CLAIMS_CLOSED` |
| 410       | `CODE_EXPIRED`, `CLAIM_EXPIRED`, `QUESTION_EXPIRED`                                                                                                                                                                               |
| 413       | `VALIDATION_FAILED` (body too large, limit 100 kB)                                                                                                                                                                                |
| 429       | `RATE_LIMITED`, `CODE_ATTEMPTS_EXCEEDED`                                                                                                                                                                                          |
| 500 / 502 | `INTERNAL`, `STELLAR_SUBMIT_FAILED`                                                                                                                                                                                               |

## 1. Health

| Method | Path      | Auth   | Request | Response                                                                                                                                                                                                                                             | Errors |
| ------ | --------- | ------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| GET    | `/health` | public | none    | 200 `HealthResponse` `{ status: "ok", database: "ok", service: "carelayer-api", contractVersion: "v1", time }`. **503** with `{ status: "unavailable", database: "down", ... }` when Postgres does not answer within 2 s. `Cache-Control: no-store`. | none   |

### 1.1 x402 proof route (development only)

| Method | Path         | Auth                  | Request                                  | Response                                                                                                    | Errors                                                                                                     |
| ------ | ------------ | --------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/x402-test` | public + x402 payment | x402 `PAYMENT-SIGNATURE` header on retry | 200 `{ ok: true, message, paidAt }` + `PAYMENT-RESPONSE` header (tx hash). Price 0.01 USDC to the treasury. | **409 `QUESTION_NOT_ANSWERED`** with `?ready=false` (guard, no payment requested); **402** without payment |

Only mounted when `X402_TEST_ROUTE=true` (refused in production). It exists to prove the x402 flow and the pay-on-delivery guard (Z2); Z8 applies the same pattern to `GET /questions/:id/answer`.

## 2. Auth (passwordless)

**Built in Z3.** Rules (`AUTH_RULES`):

- **Codes:** 6 digits, 10-min expiry, single use, stored as a peppered HMAC (never the code). Max 5 wrong tries (the 5th locks it). Resend after 45 s, max 5 per hour per email + app + purpose. A new code replaces the previous one.
- **Access token:** 15-min JWT. Every request also checks the session is still live, so logout and logout-all take effect immediately.
- **Refresh cookie:** sliding lifetime of 90 days (women), 30 days (nurses), 1 day (admin). Rotated on every refresh.
- **Refresh reuse:** reusing a refresh token more than 10 s after its first use revokes the whole session (`REFRESH_REUSED`). Within 10 s it is treated as a concurrent refresh (two tabs) and allowed. Clients should still collapse concurrent refreshes into one request, as `apps/web` does.
- **Accounts are per app:** unique on (email, role), so the same email can be a woman and a nurse. `app: "admin"` can log in but never sign up (admins are seeded).

Refresh cookie: `cl_refresh`, `HttpOnly; SameSite=Lax; Path=/auth`, plus `Secure` in production (`AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAMESITE`). Lax, not Strict, so it survives the Google redirect. A cross-site production deployment needs `SameSite=None; Secure` (decided in Z11).

Route names: the contract names below are final. `apps/web` (H5) already calls them; the `docs/TASKS.md` screen map's short names (`POST /auth/code`, `POST /auth/verify`) were aligned to these.

| Method | Path                     | Auth             | Request                                                                                                                                                                                                                | Response                                                                                                                                      | Errors                                                                                                                                                                                                                                                                                |
| ------ | ------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/code/request`     | public           | `RequestCodeBody` `{ email, purpose: "signup"\|"login"\|"step_up", app: "women"\|"nurses"\|"admin", name? }`. `name` required for signup (max 50 women, 100 nurses). `step_up` needs a bearer token and her own email. | 202 `RequestCodeResponse` `{ sent: true, resendAvailableAt }`                                                                                 | 400 `VALIDATION_FAILED` (`details.field`); 403 `FORBIDDEN` (admin signup, step-up for another email); 409 `ACCOUNT_EXISTS` (signup); 404 `ACCOUNT_NOT_FOUND` (login); 429 `RATE_LIMITED` (`details.resendAvailableAt`, `retryAfterSeconds`); 503 `SERVICE_UNAVAILABLE` (email failed) |
| POST   | `/auth/code/verify`      | public           | `VerifyCodeBody` `{ email, code, purpose: "signup"\|"login", app, name?, deviceName? }`                                                                                                                                | 200 `AuthTokensResponse` `{ accessToken, accessTokenExpiresAt, user }` + `Set-Cookie: cl_refresh`                                             | 400 `CODE_INVALID` (`details.attemptsRemaining`); 410 `CODE_EXPIRED`; 429 `CODE_ATTEMPTS_EXCEEDED`; 409 `ACCOUNT_EXISTS`; 404 `ACCOUNT_NOT_FOUND`. A malformed request never uses up the code.                                                                                        |
| POST   | `/auth/google`           | public           | `GoogleAuthBody` `{ idToken, mode: "signup"\|"login", app, name?, deviceName? }`. First Google login links Google to an existing code account with the same email.                                                     | 200 `AuthTokensResponse` + cookie                                                                                                             | 401 `GOOGLE_TOKEN_INVALID` (invalid token, unverified email, or a different Google account than the one linked); 409 `ACCOUNT_EXISTS`; 404 `ACCOUNT_NOT_FOUND`; 503 `SERVICE_UNAVAILABLE` (Google not configured)                                                                     |
| POST   | `/auth/refresh`          | cookie           | none                                                                                                                                                                                                                   | 200 `AuthTokensResponse` + rotated cookie                                                                                                     | 401 `REFRESH_INVALID`; 401 `REFRESH_REUSED` (session revoked). The cookie is cleared on any 401.                                                                                                                                                                                      |
| POST   | `/auth/logout`           | bearer or cookie | none                                                                                                                                                                                                                   | 204, cookie cleared, current session revoked. Works with an expired access token (uses the cookie) and is idempotent.                         | none                                                                                                                                                                                                                                                                                  |
| POST   | `/auth/logout-all`       | any              | none                                                                                                                                                                                                                   | 204, every session for this user revoked                                                                                                      | 401                                                                                                                                                                                                                                                                                   |
| GET    | `/auth/sessions`         | any              | none                                                                                                                                                                                                                   | 200 `SessionInfo[]` `{ id, deviceName, createdAt, lastUsedAt, current }`                                                                      | 401                                                                                                                                                                                                                                                                                   |
| DELETE | `/auth/sessions/:id`     | any              | none                                                                                                                                                                                                                   | 204                                                                                                                                           | 401; 404                                                                                                                                                                                                                                                                              |
| POST   | `/auth/step-up`          | any              | `StepUpBody` `{ code }` (code from `/auth/code/request` with `purpose: "step_up"`)                                                                                                                                     | 200 `StepUpResponse` `{ freshUntil }`: this session may withdraw / change the payout address until then (5 min). No token to send.            | 400 `CODE_INVALID`; 410 `CODE_EXPIRED`; 429 `CODE_ATTEMPTS_EXCEEDED`                                                                                                                                                                                                                  |
| POST   | `/auth/agent-tokens`     | woman (session)  | `CreateAgentTokenBody` `{ label }` (1–60 characters)                                                                                                                                                                   | 201 `CreateAgentTokenResponse` `{ id, label, token, createdAt }`. `token` starts with `clat_` and is shown **once** (stored as a keyed hash). | 400; 401; 403 (not a woman, or called with an agent token); 409 `CONFLICT` (already `MAX_AGENT_TOKENS` = 5 active)                                                                                                                                                                    |
| GET    | `/auth/agent-tokens`     | woman (session)  | none                                                                                                                                                                                                                   | 200 `AgentTokenSummary[]` `{ id, label, createdAt, lastUsedAt }`, newest first, active only. Never the token.                                 | 401; 403                                                                                                                                                                                                                                                                              |
| DELETE | `/auth/agent-tokens/:id` | woman (session)  | none                                                                                                                                                                                                                   | 204. Immediate: Claude's next call gets 401.                                                                                                  | 401; 403; 404                                                                                                                                                                                                                                                                         |

## 3. Users, settings and notifications

| Method | Path                | Auth  | Request                                                       | Response                                                                                                                                 | Errors   |
| ------ | ------------------- | ----- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| GET    | `/me`               | any   | none                                                          | 200 `User` `{ id, role: "woman"\|"nurse"\|"admin", displayName, email, createdAt }`                                                      | 401      |
| PATCH  | `/me`               | any   | `UpdateMeBody` `{ displayName? }`                             | 200 `User`                                                                                                                               | 400; 401 |
| GET    | `/me/settings`      | any   | none                                                          | 200 `UserSettings` `{ appearance, quickExitTarget, spendingLimitPerAnswerKobo, mcpSpendingLimitPerAnswerKobo, mcpAskBeforeEachPayment }` | 401      |
| PATCH  | `/me/settings`      | any   | `UpdateSettingsBody` (any subset of `UserSettings`)           | 200 `UserSettings`                                                                                                                       | 400; 401 |
| GET    | `/me/notifications` | woman | none                                                          | 200 `NotificationPreferences` `{ notifyWhenAnswered }`                                                                                   | 401      |
| PATCH  | `/me/notifications` | woman | `UpdateNotificationPreferencesBody` `{ notifyWhenAnswered? }` | 200 `NotificationPreferences`                                                                                                            | 400; 401 |

**Built** (after Z6, for H7's account screen):

- **Defaults** for a new account: `DEFAULT_USER_SETTINGS` (system appearance, Google quick exit, ₦1,000 limit, ₦500 Claude limit, ask before each Claude payment). Notifications are on.
- **`PATCH /me/settings`:**
  - Send any subset, at least one field. Unknown fields → 400.
  - Spending limits are whole kobo, from ₦0 to ₦100,000 (`SPENDING_LIMIT_KOBO`).
  - **Nurses and admins may change `appearance` only.** Sending a women-only field (`WOMEN_ONLY_SETTINGS`) → 400 `VALIDATION_FAILED` with `details.field`, and nothing is applied. (v1 said those fields would be silently ignored; an explicit error makes a client bug visible instead.)
- **`/me/notifications`:** nurses and admins get 403.
- An account with no settings row gets the defaults; these routes never 404.
- Both GETs send `Cache-Control: no-store`.

`appearance` is also kept in `localStorage` so the theme applies before sign-in. Notifications are **email only** (no push).

## 4. Wallet

**Built in Z4.** Every user gets a custodial Stellar testnet wallet in the same write as their account. The secret is encrypted at rest (AES-256-GCM) and never leaves the server. Balances are shown in naira at the fixed demo rate.

- **Activation:** one transaction from the treasury sponsors the account's reserves, creates it with 0 XLM, and adds the USDC trustline. The user never needs XLM.
- **When:** activation runs right after sign-up. Sign-up never waits for or fails because of Stellar. Failed attempts are retried in the background (backoff 1, 2, 4… up to 30 minutes), and also when she opens her wallet.
- **`status`:** `pending` until the account exists on-chain, then `active`. A pending wallet shows its address and a 0 balance, and cannot receive money yet.
- **Balance:** the chain is the source of truth. `GET /wallet` reads it live (4 s limit). If Stellar does not answer, it returns the last known balance, and `balanceSyncedAt` says when that was read.

| Method | Path                   | Auth | Request     | Response                                                                                                                                                                                                                         | Errors                                             |
| ------ | ---------------------- | ---- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| GET    | `/wallet`              | any  | none        | 200 `WalletResponse` `{ stellarAddress, status: "pending"\|"active", balance: Money, balanceSyncedAt, freeAnswersRemaining }` (null for nurses and admins). `Cache-Control: no-store`.                                           | 401                                                |
| GET    | `/wallet/transactions` | any  | `PageQuery` | 200 `Page<WalletTransaction>`, newest first. Confirmed movements only. **Women:** top-ups (+), answers paid from her wallet (−); free answers are not listed. **Nurses:** earnings (+), withdrawals (−). `nextCursor` is opaque. | 400 `VALIDATION_FAILED` (bad cursor or limit); 401 |

`WalletTransaction = { id, kind: "topup"|"answer_payment"|"answer_earning"|"withdrawal", amount: Money (negative for money out, on both fields), stellarTxHash, questionId, createdAt }`. Explorer links: `stellarExplorerUrl("tx", hash)` / `stellarExplorerUrl("account", address)` from `@carelayer/shared`.

There is **no** withdraw endpoint for women.

## 5. Top-up (Paystack TEST mode)

**Built in Z5.** She pays naira on Paystack (test mode: card, bank transfer, USSD); the treasury then sends the same value in test USDC to her wallet at the fixed demo rate.

**Flow**

1. `POST /topups { amountKobo }` (₦100 to ₦100,000, `TOPUP_LIMITS_KOBO`) returns `authorizationUrl`. Redirect her there (full page).
2. After paying, Paystack sends her back to the wallet screen with `?topupId=...&reference=...` (`PAYSTACK_CALLBACK_URL`).
3. Poll `GET /topups/:topupId` (every 2-3 s, stop when `credited` or `failed`).

**Statuses:** `pending` (not paid yet), `paid` (Paystack confirmed; USDC on its way, usually seconds), `credited` (in her wallet, `stellarTxHash` set), `failed` (payment failed, abandoned after 24 h, or the paid amount did not match).

**Robustness**

- A payment counts only once Paystack confirms it: either through the signed webhook, or through a server-side verify. Each `GET /topups/:id` and a background loop do the verify, so it works without webhooks (local dev).
- The paid amount and currency must match the top-up.
- Credited at most once: duplicate webhooks are ignored, and the Stellar payment carries the top-up id as its memo, so a retry after a crash finds the earlier payment instead of paying twice. If her wallet is still `pending`, it is activated first.

| Method | Path                 | Auth                                                                                         | Request                            | Response                                                                                           | Errors                                                                                                                                       |
| ------ | -------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/topups`            | woman                                                                                        | `CreateTopupBody` `{ amountKobo }` | 201 `CreateTopupResponse` `{ topupId, reference, authorizationUrl }`                               | 400 `VALIDATION_FAILED` (`details.field: "amountKobo"`); 401; 403 (not a woman); 503 `SERVICE_UNAVAILABLE` (Paystack not configured or down) |
| GET    | `/topups/:id`        | woman (own)                                                                                  | none                               | 200 `Topup` `{ id, status: "pending"                                                               | "paid"                                                                                                                                       | "credited" | "failed", amount: Money, stellarTxHash, createdAt }` | 401; 404 |
| POST   | `/webhooks/paystack` | Paystack signature (`x-paystack-signature`: HMAC-SHA512 of the raw body with the secret key) | Paystack event                     | 200 `{ received: true }` (also for events we ignore). On `charge.success`: mark paid, then credit. | 401 `PAYSTACK_SIGNATURE_INVALID`                                                                                                             |

## 6. Emergencies

**Built in Z6.** Every chat message, draft and `POST /questions` is checked **first** against `apps/api/config/red-flags.json`, then by the LLM's own judgement (`redFlagSuspected`). On a match the endpoint returns `EmergencyResponse` (HTTP 200) instead of its normal result. Free. Nothing is queued, no question is created. The server logs an `EmergencyEvent` with **source and timestamp only** (no user, no text, no red-flag id).

- **What is checked:** `POST /chat` checks her new message (an earlier emergency in the thread does not repeat on every later message). `POST /chat/draft` and `POST /questions` check the whole question.
- **Matching:** case-insensitive substring after normalising both sides (lowercase, curly quotes to straight, whitespace collapsed). The fixed list runs before the LLM, so it works even when the LLM is down.
- **`triggeredBy`:** the matching red-flag ids, or `["llm"]`.
- **Sources:** `CHAT` (chat and drafts), `QUESTION` (`POST /questions`), `MCP` (Z12).
- **Contacts:** `112` (national emergency number) with `verified: false` until someone has checked it (docs/QUESTIONS.md Q2). `findHospitalUrl` opens a map search on her device; CareLayer never sees her location.

```ts
EmergencyResponse = { kind: "emergency", message, triggeredBy: string[], contacts: EmergencyContact[], findHospitalUrl }
EmergencyContact  = { label, number, verified }
```

| Method | Path         | Auth   | Request | Response                                                                                              | Errors |
| ------ | ------------ | ------ | ------- | ----------------------------------------------------------------------------------------------------- | ------ |
| GET    | `/emergency` | public | none    | 200 `EmergencyResponse` (static content, `triggeredBy: []`) for clients that want to show it directly | none   |

Emergency numbers must be verified (`verified: true`) before the demo.

## 7. Chat (AI assistant, free)

**Built in Z6. Saved chats added 2026-11-24.** The client sends the thread it shows with every message (so the assistant answers what she sees), and `POST /chat` saves the outcome to her account in a **conversation**: her message plus the reply, or her message alone when it raised an emergency. Nothing is saved when the assistant fails, so a retry never duplicates. Conversations are hers only: never shown to nurses, and agent tokens (Claude) are refused. She can delete any of them. Questions sent to nurses are stored separately (§8).

- **LLM:** Hikmah's `apps/api/prompts/assistant.md` (Mode A for chat, Mode B for drafts). It is called through any OpenAI-compatible API (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`); the default is NVIDIA's free tier with `nvidia/nemotron-3-ultra-550b-a55b`, which takes about 10 s per call.
- **Limits (`CHAT_LIMITS`):**
  - At most 40 turns per request; the server sends the last 20 to the model.
  - Each turn: 1 to 4,000 characters.
  - `POST /chat`: the last turn must be hers (`role: "user"`).
  - `POST /chat/draft`: at least one turn must be hers; the thread may end with the assistant's offer.
  - A question (her messages joined): at most 8,000 characters.
  - At most 12 chat + draft requests per woman per minute.
- **LLM down or not configured:** `503 SERVICE_UNAVAILABLE`. The message says to try again and to go to the nearest hospital if it is urgent. `details: { retryable, reason }`, with `reason` one of `rate_limited`, `timeout`, `upstream`, `bad_response`, `not_configured`, `auth`.

| Method | Path                      | Auth            | Request                                                       | Response                                                                                                                                                            | Errors                                                                                              |
| ------ | ------------------------- | --------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| POST   | `/chat`                   | woman           | `ChatRequestBody` `{ messages: ChatTurn[], conversationId? }` | 200 `ChatResponse`: `{ kind: "reply", message: ChatMessage, escalationOffer: EscalationOffer \| null, conversationId }` or `EmergencyResponse & { conversationId }` | 400 `VALIDATION_FAILED`; 401; 403; 404 `NOT_FOUND` (conversation not hers); 429 `RATE_LIMITED`; 503 |
| GET    | `/chat/conversations`     | woman (session) | `?cursor&limit`                                               | 200 `Page<ConversationSummary>`, most recently active first                                                                                                         | 400 (bad cursor); 401; 403                                                                          |
| GET    | `/chat/conversations/:id` | woman (session) | none                                                          | 200 `Conversation`                                                                                                                                                  | 401; 403; 404 `NOT_FOUND`                                                                           |
| DELETE | `/chat/conversations/:id` | woman (session) | none                                                          | 204, the conversation and its messages are deleted                                                                                                                  | 401; 403; 404 `NOT_FOUND`                                                                           |
| POST   | `/chat/draft`             | woman           | `DraftRequestBody` `{ messages: ChatTurn[] }`                 | 200 `DraftResponse`: `{ kind: "draft", draft: QuestionDraft, draftToken, draftExpiresAt, offer: EscalationOffer }` or `EmergencyResponse`                           | 400 (incl. question too long, `details.field: "messages"`); 401; 403; 429; 503                      |

- `ChatTurn = { role: "user" | "assistant", text }`. `ChatMessage = { id, role: "assistant", text, createdAt }`.
- `conversationId`: omit on her first message (a conversation is created, titled with the start of her message); send it back on the next ones. Another woman's id is 404. In the response it is `null` only if saving failed (the reply or emergency is still returned; the app keeps the chat it shows).
- `ConversationSummary = { id, title, preview, messageCount, createdAt, updatedAt }`: `title` is the start of her first message, `preview` the start of the last message.
- `Conversation = { id, title, createdAt, updatedAt, messages: ConversationMessage[] }`, oldest first. `ConversationMessage = { id, role, text, emergency, createdAt }`; `emergency: true` marks her message that raised an emergency (no reply follows it).
- `EscalationOffer = { price, isFree, freeAnswersRemaining, suggestedCategory, exceedsSpendingLimit }`. It is present when the assistant suggests a nurse. `exceedsSpendingLimit` is true only when she would pay and the price is above her per-answer limit.
- `QuestionDraft = { originalText, cleanedText, assistantNotes, category, ageRange, pregnancyWeeks }`:
  - `originalText`: all of her messages in the thread, joined with a blank line, word for word (the assistant's turns are not included).
  - `cleanedText`: spelling and grammar fixed only. If the model shortens the question or drops any number she wrote (checked in code, one retry), her original words are used instead.
  - `ageRange` / `pregnancyWeeks`: only when she stated them (her age as a number, weeks as weeks). The age range is computed in code.
- **`draftToken`:** signed, bound to her account, valid 2 hours (`draftExpiresAt`). Send it with `POST /questions` so the stored question is exactly what she saw on W07.
- **"Ask a nurse directly":** call `POST /chat/draft` with her question as the only turn.

## 8. Questions (agent-facing, x402 pay on delivery)

Any agent can call these: our web app (through the API's own agent), Claude via `apps/mcp`, or third-party apps.

### 8.0 Nurse directory (W08 "Choose who answers")

| Method | Path      | Auth                  | Request                                    | Response                                                                                                                                                                                                           | Errors        |
| ------ | --------- | --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| GET    | `/nurses` | woman (agents in Z12) | `NurseListQuery` `?topic=&femaleOnly=true` | 200 `NursePublicProfile[]`: approved, available nurses only. `{ id, fullName, role, gender, yearsOfPractice, bio, languages, topics, available, verified: true, avgResponseMinutes, helpful: { percent, count } }` | 400; 401; 403 |

Rating is "% helpful + count" (e.g. "96% helpful (212)"); `percent` is null until the first feedback. No stars. No email, phone or licence number. Sorted fastest average response first, nurses with no answers yet after them, then by name.

### 8.1 Create

| Method | Path         | Auth                | Request                                                                                                                                                                                                                                               | Response                                                                                                                                                                                     | Errors                                                                                                                                                                                                                                                                                                                     |
| ------ | ------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/questions` | woman + agent token | `CreateQuestionBody` `{ originalText, source: "web" (session) \| "mcp" (agent token), consent: { sharedFields, consentVersion }, nurseSelection?: "first_available"\|"chosen_nurse", chosenNurseId?, femaleOnly?, approvedAboveLimit?, draftToken? }` | 201 `CreatedQuestion` `{ kind: "question", id, status: "open", category, price, isFree, nurseSelection, chosenUntil, claimsCloseAt, questionKey, createdAt }` **or** 200 `EmergencyResponse` | 400 `VALIDATION_FAILED` (incl. `details.field: "draftToken"` expired/invalid, `"originalText"` not the draft's) / `CONSENT_REQUIRED` (`details.missing`); 401; 403; 409 `SPENDING_LIMIT_EXCEEDED` (`details: { priceKobo, spendingLimitKobo }`); 409 `CHOSEN_NURSE_UNAVAILABLE`; 503 (no `draftToken` and the LLM is down) |

`SharedField` = `cleaned_text | original_text | assistant_notes | category | age_range | pregnancy_weeks`. Never her name, email, phone or location. `cleaned_text` and `category` are required (`REQUIRED_SHARED_FIELDS`).

Server behaviour:

1. Consent: missing, or not sharing `cleaned_text` + `category` → 400 `CONSENT_REQUIRED`. Stored per question (fields shared, consent text version, time).
2. Red-flag check on `originalText` (see §6).
3. Store `originalText` **verbatim** (validated, never trimmed).
4. **With `draftToken`** (the web app): the question is the signed draft from `POST /chat/draft`, so what is stored is exactly what she saw. `originalText` must equal the draft's. No second LLM call. **Without it**: the server runs the same clean-up (Mode B), including the LLM's red-flag check.
5. `cleanedText` is spelling and grammar only, **never summarised or shortened**. `assistantNotes`, `ageRange` and `pregnancyWeeks` are stored only if she shared them.
6. `category` comes from the LLM.
7. **Alerts** (after the response): an email to every approved, available nurse with that topic (female only if `femaleOnly`); for `chosen_nurse`, only to her. The email names the topic only; the question stays in the nurse app.
8. **Selection.** `first_available` (default): any eligible nurse. `chosen_nurse`: `chosenNurseId` must be an approved, available nurse (and female if `femaleOnly`). She alone can see and claim it until `chosenUntil` (created + 10 min); after that, or if she releases or her claim expires, it opens to everyone.
9. **`femaleOnly`**: only nurses with gender `female` can see or claim it.
10. **Expiry.** `claimsCloseAt` = created + 30 min. No new claims after that. An active claim may finish its 10-minute lock (max wait 40 min). Unanswered → `expired`, she pays nothing.
11. `isFree` is true while she has free answers left (first 3, minus her free questions still in flight). It is a quote: the final charge is decided when she collects the answer. Third-party agents without a CareLayer account always pay.
12. `questionKey` is returned only to callers without a CareLayer session; they send it as `X-Question-Key` afterwards.

### 8.2 Status

| Method | Path                    | Auth                        | Request | Response                                                                                                                                             | Errors   |
| ------ | ----------------------- | --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| GET    | `/questions/:id/status` | woman + agent token (owner) | none    | 200 `QuestionStatusResponse` `{ id, status: "open"\|"claimed"\|"answered"\|"expired"\|"cancelled", category, claimsCloseAt, answeredAt, expiredAt }` | 401; 404 |

### 8.3 Answer (x402-protected)

| Method | Path                    | Auth                                        | Request                                                              | Response                                                                                                                                                                                                                               | Errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------ | ----------------------- | ------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/questions/:id/answer` | woman (owner; agents in Z12) + x402 payment | `PAYMENT-SIGNATURE` header on the paid retry (`X-PAYMENT` also read) | 200 `AnswerResponse` `{ answer: Answer, payment: { amount, stellarTxHash, paidFromTreasury } }` + `PAYMENT-RESPONSE` header when this request settled a payment. Free answers and already-collected answers: 200 with no payment step. | 404; **409 `QUESTION_NOT_ANSWERED`** (guard, runs before payment; also open/claimed/cancelled); 410 `QUESTION_EXPIRED`; **402** x402 payment requirements (`PAYMENT-REQUIRED` header; body = the same `PaymentRequired` JSON, with `error` when a payment was refused or did not settle); **503 `SERVICE_UNAVAILABLE`** `details: AnswerUnavailableDetails` (facilitator busy or down, or a payment still being confirmed: retry; nothing charged); 409 `CONFLICT` (another payment for it is in progress) |

x402 details (decided in Z2, see the decisions log in `docs/TASKS.md`): official `@x402/*` packages, OpenZeppelin Channels facilitator, network `stellar:testnet`, asset = testnet USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, amount in stroops. Headers: `PAYMENT-REQUIRED` on the 402 (base64 JSON), `PAYMENT-SIGNATURE` on the paid retry, `PAYMENT-RESPONSE` on the 200 (base64 JSON with the settlement `transaction` hash). The facilitator sponsors fees: the payer spends only the USDC price.

Order of steps is part of the contract (built in Z8 as a manual x402 flow, see "Z8 changes" at the top):

1. **Owner check** (404 if not hers).
2. **Answered guard**: 410 `QUESTION_EXPIRED` if expired, else 409 `QUESTION_NOT_ANSWERED` unless answered. Unanswered questions never request payment.
3. **Already collected**: the same answer and receipt again. Never charged or paid twice.
4. **Free**: quoted free and she still has one of her first 3 → no payment; `paidFromTreasury: true`, `amount` ₦0, `stellarTxHash: null`. If her 3 are used by then, she pays.
5. **x402**: no payment header → 402 with requirements (USDC on Stellar testnet, `payTo` = platform address, amount = the question's price in stroops, `maxTimeoutSeconds` 120). With a payment: verify → **the attempt is recorded** → settle → **only after a successful settle** is the answer read and returned. A failed settle returns 402 (or 503) and no answer text.
6. **Split**: 80% to the nurse, 20% platform (`PAYOUT_SPLIT`). The nurse's payout is a treasury payment sent right after (retried in the background, never delays her answer). Free answers: the treasury pays the nurse's 80% too. Both transaction hashes are stored.
7. **Indeterminate settle** (facilitator timeout, 5xx, lost connection): the payment may have gone through. It stays pending and every later request looks for it on chain first (her wallet → platform, exact amount): found → confirmed and the answer is returned; not found after the payment's own deadline → failed, and she can pay again; otherwise 503 with `paymentPending: true`. She is never asked to pay twice for one answer.

`Answer = { questionId, text, nurse: PublicNurse, recommendSeeSomeoneToday, answeredAt }`. `PublicNurse = { id, displayName, role, verified: true }`. **No contact details, ever.**

### 8.4 Her questions and feedback (web app)

| Method | Path                        | Auth                | Request                                                                        | Response                                                                                                                                                                                                                                     | Errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | --------------------------- | ------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/me/questions`             | woman               | `?status=` (a status or `active` = open + claimed) + `PageQuery`               | 200 `Page<MyQuestion>`                                                                                                                                                                                                                       | 401                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| GET    | `/me/questions/:id`         | woman               | none                                                                           | 200 `MyQuestion`                                                                                                                                                                                                                             | 401; 404                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| POST   | `/me/questions/:id/collect` | woman + agent token | `CollectAnswerBody` `{ approvedAboveLimit?, confirmPayment? }` (optional body) | 200 `AnswerResponse`. The API's own agent runs `GET /questions/:id/answer`: free if she has a free answer, else it checks her limit and balance and pays over x402 from her custodial wallet (in process, same code path as the HTTP route). | 404; 409 `QUESTION_NOT_ANSWERED`; 410 `QUESTION_EXPIRED`; 409 `SPENDING_LIMIT_EXCEEDED` (`details: { priceKobo, spendingLimitKobo }`; send `approvedAboveLimit: true` after she approves); 409 `INSUFFICIENT_BALANCE` (`details: { price, balance }`; also when her wallet is not active yet); **409 `PAYMENT_CONFIRMATION_REQUIRED`** (agent token only: `details: { price }`; send `confirmPayment: true` once she agreed); 503 `SERVICE_UNAVAILABLE` (`AnswerUnavailableDetails`: not charged, retry) |
| POST   | `/questions/:id/feedback`   | woman               | `FeedbackBody` `{ helpful }`                                                   | 200 `FeedbackResponse` `{ questionId, helpful, updatedAt }`. One per answer; sending again changes it. Updates the nurse's % helpful.                                                                                                        | 400; 401; 404; 409 `QUESTION_NOT_ANSWERED` (not answered, or not collected yet)                                                                                                                                                                                                                                                                                                                                                                                                                          |

`MyQuestion = { id, status, category, originalText, cleanedText, price, isFree, nurseSelection, chosenNurse, femaleOnly, claimsCloseAt, answer, feedback, createdAt }`.

## 9. Claiming and answering (nurses)

**Built in Z7.**

- **Claims:**
  - Only `approved` nurses can claim (403 `NURSE_NOT_APPROVED` on every route below except `/nurse/dashboard`).
  - One active claim per nurse and per question, enforced by the database. Two nurses claiming at once: exactly one wins.
  - 10-minute lock (`CLAIM_LOCK_MINUTES`).
  - When a claim is released or expires, the question returns to `open`, or becomes `expired` if claims have already closed.
- **Visibility ("Waiting" tab).** An open question is visible to a nurse when all of these hold:
  - She is approved.
  - Claims are still open (under 30 minutes).
  - `femaleOnly` is false, or her gender is `female`.
  - The question has no chosen nurse, or the chosen window has passed (or fell back), or she is the chosen nurse.

  Topics control **alerts only**: all eligible open questions stay visible.

- **Time-based changes** are applied on every request **and** by a background sweeper every 30 s:
  - claims past their lock expire;
  - chosen-nurse questions open to everyone after 10 minutes, and the other eligible nurses are emailed;
  - open questions expire after 30 minutes.

  A late sweeper never makes a response wrong.

- **When a nurse answers:**
  - The question becomes `answered`.
  - The nurse's average response time is recomputed.
  - If the woman turned on `notifyWhenAnswered`, she gets an email that only says a health worker replied, with a link to the question. It contains no answer text and no health detail.

| Method | Path                           | Auth               | Request                                                                                            | Response                                                                                                                                                                                                     | Errors                                                                                                                                                                                                                |
| ------ | ------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/nurse/dashboard`             | nurse (any status) | none                                                                                               | 200 `NurseDashboard` `{ verificationStatus, available, topics, activeClaim, waitingCount, chosenForYouCount, answeredToday, answeredThisWeek, avgResponseMinutes, helpful }` (Lagos days, weeks from Monday) | 401                                                                                                                                                                                                                   |
| GET    | `/nurse/questions`             | nurse              | `?tab=waiting\|active\|completed` (default waiting) + `PageQuery`                                  | 200 `Page<NurseQuestionView>`. `waiting`: chosen-for-you first, then oldest first, up to `limit`, `nextCursor: null`. `active`: 0 or 1 item. `completed`: newest first, cursor pages.                        | 400 (bad tab or cursor); 401; 403 `NURSE_NOT_APPROVED`                                                                                                                                                                |
| GET    | `/nurse/questions/:id`         | nurse              | none                                                                                               | 200 `NurseQuestionView` (visible to her, or one she has claimed or answered)                                                                                                                                 | 401; 404                                                                                                                                                                                                              |
| GET    | `/nurse/claim`                 | nurse              | none                                                                                               | 200 `NurseQuestionView \| null` (current claim, with `claimExpiresAt` for the countdown)                                                                                                                     | 401                                                                                                                                                                                                                   |
| POST   | `/nurse/questions/:id/claim`   | nurse              | none                                                                                               | 200 `Claim` `{ questionId, expiresAt }`                                                                                                                                                                      | 403 `NURSE_NOT_APPROVED`; 409 `QUESTION_ALREADY_CLAIMED`; 409 `ACTIVE_CLAIM_EXISTS` (`details.questionId` = the one she holds); 409 `CLAIMS_CLOSED` (after 30 min); 410 `QUESTION_EXPIRED`; 404 if not visible to her |
| POST   | `/nurse/questions/:id/release` | nurse              | none                                                                                               | 204 (question back to `open`; a chosen-nurse question opens to everyone)                                                                                                                                     | 403 `NOT_CLAIM_OWNER`; 410 `CLAIM_EXPIRED`                                                                                                                                                                            |
| POST   | `/nurse/questions/:id/answer`  | nurse              | `SubmitAnswerBody` `{ text (1–5,000 chars, `ANSWER_TEXT_MAX_LENGTH`), recommendSeeSomeoneToday? }` | 201 `Answer`                                                                                                                                                                                                 | 400; 403 `NOT_CLAIM_OWNER`; 410 `CLAIM_EXPIRED` (lock ran out: nothing is saved)                                                                                                                                      |

`NurseQuestionView = { id, status, category, cleanedText, originalText (null if not shared), assistantNotes, ageRange, pregnancyWeeks, femaleOnly, chosenForYou, claimsCloseAt, createdAt, claimExpiresAt }`. The woman is anonymous: no name, email, wallet, location or chat history.

## 10. Nurse onboarding and profile

**Built in Z9.** Lifecycle: `draft` → (submit) `pending_review` → (admin) `approved` | `rejected` → fix and submit again.

| Method | Path                    | Auth            | Request                                                                                                                                                                               | Response                                                                                                        | Errors                                                                                                                                 |
| ------ | ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/nurse/profile`        | nurse           | none                                                                                                                                                                                  | 200 `NurseProfile` (created at sign-up as `draft` with her sign-up name)                                        | 401                                                                                                                                    |
| PATCH  | `/nurse/profile`        | nurse           | `UpdateNurseProfileBody` `{ fullName?, role?, fullNameConfirmed?, gender?, practiceArea?, yearsOfPractice?, bio? (≤280), languages?, licenceNumber?, guidanceNotDiagnosisAccepted? }` | 200 `NurseProfile` (`topics` defaulted from role the first time a role is set)                                  | 400 (`details.field`; unknown fields refused); 409 `CONFLICT` (licence number already registered, or licence fields locked: see below) |
| POST   | `/nurse/documents`      | nurse           | multipart: `type` (`NurseDocumentType`), `file` (PDF, JPEG, PNG, WebP or HEIC, max 10 MB)                                                                                             | 201 `NurseDocument` `{ id, type, fileName, mimeType, sizeBytes, uploadedAt }`. Re-uploading a type replaces it. | 400 (`details.field: "type"` or `"file"`: missing, or not an allowed type by content); 413 (over 10 MB); 409 `CONFLICT` (locked)       |
| DELETE | `/nurse/documents/:id`  | nurse           | none                                                                                                                                                                                  | 204                                                                                                             | 401; 404; 409 if `pending_review`/`approved`                                                                                           |
| POST   | `/nurse/profile/submit` | nurse           | none                                                                                                                                                                                  | 200 `NurseProfile` with `verificationStatus: "pending_review"` (again: no change)                               | 409 `ONBOARDING_INCOMPLETE` (`details.missing: OnboardingRequirement[]`); 409 `CONFLICT` if already approved                           |
| PATCH  | `/nurse/preferences`    | nurse           | `UpdateNursePreferencesBody` `{ topics?, available? }`                                                                                                                                | 200 `NurseProfile`                                                                                              | 400 `TOPICS_REQUIRED` (empty topics)                                                                                                   |
| PUT    | `/nurse/payout-address` | nurse + step-up | `UpdatePayoutAddressBody` `{ stellarAddress \| null }`                                                                                                                                | 200 `NurseProfile`                                                                                              | 400 `STELLAR_ADDRESS_INVALID`; 403 `STEP_UP_REQUIRED`                                                                                  |

Roles: `nurse` or `midwife` only. All are registered with the Nursing and Midwifery Council of Nigeria (`NURSE_REGULATOR = "NMCN"`). Topic defaults (`DEFAULT_TOPICS_BY_ROLE`): midwives get Pregnancy + Periods; nurses get all. Languages from a fixed list: `english`, `pidgin`, `yoruba`, `hausa`, `igbo`.

- **Required to submit (`ONBOARDING_REQUIREMENTS`):** role, full name confirmed, years, licence number, the guidance-not-diagnosis agreement, and all four documents (`practising_licence`, `registration_certificate`, `government_id`, `selfie_with_id`). Topics are defaulted from the role.
- **Locked while `pending_review` and once `approved`:**
  - The licence fields (`LICENCE_FIELDS`: full name, role, licence number, name confirmation) → 409 with `details.field`.
  - The documents (upload or delete) → 409.
  - The admin reviewed exactly these. Everything else (bio, languages, practice area, years, gender, topics, available) stays editable.
- **`fullName`** is her name as on the licence. Changing it also changes her display name (`GET /me`).
- **Documents:**
  - The type is detected from the file's bytes, never from the name or the browser's claim (`NURSE_DOCUMENT_UPLOAD`).
  - Files are stored privately in the database. The nurse never gets a URL, and nobody gets a public one.
- **Approved only:** `/nurse/questions*` and `/nurse/claim` answer **403 `NURSE_NOT_APPROVED`** unless she is approved. The routes themselves come in Z7.

## 11. Admin verification

| Method | Path                         | Auth        | Request                                                                                      | Response                                                                                                               | Errors                                                                             |
| ------ | ---------------------------- | ----------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/admin/nurses`              | admin       | `?status=draft\|pending_review\|approved\|rejected` (default `pending_review`) + `PageQuery` | 200 `Page<AdminNurseSummary>`, oldest first                                                                            | 400; 401; 403                                                                      |
| GET    | `/admin/nurses/:id`          | admin       | none                                                                                         | 200 `AdminNurseDetail` (profile + email + `documentUrls`: document id → signed link, 10 minutes)                       | 401; 403; 404                                                                      |
| POST   | `/admin/nurses/:id/approve`  | admin       | none                                                                                         | 200 `AdminNurseSummary` (`approved`)                                                                                   | 403; 404; 409 if not `pending_review`                                              |
| POST   | `/admin/nurses/:id/reject`   | admin       | `RejectNurseBody` `{ reason }` (5–500 characters; she sees it)                               | 200 `AdminNurseSummary` (`rejected`; she is set unavailable)                                                           | 400; 403; 404; 409 if not `pending_review`                                         |
| GET    | `/files/nurse-documents/:id` | signed link | `?exp=&a=&sig=` (from `documentUrls`)                                                        | 200 the file, with its detected `Content-Type`, `Cache-Control: private, no-store`, `nosniff` and a sandboxing CSP     | 403 (no or invalid signature, or another document's link); 410 `LINK_EXPIRED`; 404 |
| GET    | `/admin-console`             | public page | none                                                                                         | Minimal admin page (HTML). It signs in with a code (`app: "admin"`) and uses the routes above; the page holds no data. | none                                                                               |

- **The admin checks the licence by hand against the NMCN register,** using the documents.
- **Decisions are conditional on `pending_review`,** so two admins deciding at once cannot both win (the second gets 409).
- **She is emailed the result** (approved, or rejected with the reason).
- **Document links:**
  - Signed (HMAC), valid 10 minutes, bound to the admin who opened the nurse, so every view is logged with the admin's id.
  - Not bearer-authenticated, so they open in a new tab or an `<img>`.
  - Open the nurse again for fresh links.

## 12. Earnings and withdrawals (nurses)

Built in Z10. Any signed-in nurse, whatever her verification status: earned money stays hers. Screen: N09 Earnings.

| Method | Path                 | Auth            | Request                                                                                                                    | Response                                                                                                                                                                                                                                                        | Errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | -------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/nurse/earnings`    | nurse           | none                                                                                                                       | 200 `EarningsResponse` `{ available, balance, balanceSyncedAt, stellarAddress, payoutAddress, totalEarned, answersCount, thisWeek: { from, total, answersCount, days[7] }, thisMonth: { from, total, answersCount }, recent[≤10] }`. `Cache-Control: no-store`. | 401; 403 (not a nurse)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/nurse/withdrawals` | nurse           | `PageQuery`                                                                                                                | 200 `Page<Withdrawal>`, newest first                                                                                                                                                                                                                            | 400 (bad cursor or limit); 401                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| POST   | `/nurse/withdrawals` | nurse + step-up | `CreateWithdrawalBody` `{ amountKobo, destination: { kind: "stellar", address, memo?: { type: "text" \| "id", value } } }` | 201 `Withdrawal` `{ id, status: "confirmed" \| "submitted", amount, destinationAddress, destinationMemo, stellarTxHash, failureReason, createdAt, confirmedAt }` (real testnet payment)                                                                         | 400 `STELLAR_ADDRESS_INVALID` (`details.field: "destination.address"`: not a G… address, her own CareLayer wallet, no account there, or no USDC trustline); 400 `VALIDATION_FAILED` (`amountKobo` below ₦100, not Stellar, or a memo Stellar would refuse: `details.field: "destination.memo"`); 403 `STEP_UP_REQUIRED`; 409 `INSUFFICIENT_BALANCE` (`details: { available, requested }`); 409 `CONFLICT` (a withdrawal is already in progress); 502 `STELLAR_SUBMIT_FAILED` (Stellar refused it: nothing left her wallet); 503 `SERVICE_UNAVAILABLE` (Stellar not answering, or no treasury configured) |

- **Earnings** are her payouts (§8.3): the 80% of every collected answer, free answers included. Days and weeks are Lagos time; weeks start on Monday. `thisWeek.days` always has 7 entries (Mon–Sun, `isToday` marks today) for the N09 chart.
- **`recent`** mixes `EarningEntry` (`kind: "earning"`, `title` = the start of the question she answered, `status: "pending" | "confirmed"`) and `WithdrawalEntry` (`kind: "withdrawal"`, negative amount), newest first, at most 10. Failed withdrawals are not listed there. "See all": `GET /wallet/transactions` (confirmed movements) or `GET /nurse/withdrawals`.
- **`available`** = `balance` (USDC in her CareLayer wallet, read from Stellar) minus withdrawals still in progress. `payoutAddress` is set when she chose her own payout wallet (§10): payouts then go there, so they do not add to `balance`.
- **Withdrawal:**
  - Needs a code verified on this session in the last 5 minutes (`POST /auth/step-up`).
  - Minimum ₦100 (`MIN_WITHDRAWAL_KOBO`), at most `available`.
  - Stellar address only. The destination must exist and trust testnet USDC, so the money can always land.
  - The payment is signed by her CareLayer wallet. The fee is paid by the platform (her wallet holds no XLM).
  - One withdrawal at a time.
  - **Memo (optional):** only when the receiving wallet asks for one. Exchanges credit deposits by memo, and a deposit without it can be lost. `type: "text"` (up to 28 bytes) or `"id"` (digits, an unsigned 64-bit number). Use the type the exchange shows; most use a memo ID. A personal wallet needs no memo.
- **`status: "submitted"`** means Stellar did not answer in time. The payment may still land. Within about 3 minutes it becomes `confirmed` (found on Stellar, hash recorded) or `failed` (nothing left her wallet). It is never sent twice. Show "Processing" and refresh `GET /nurse/withdrawals`.

Bank withdrawal: UI shows "Coming soon". No endpoint.

## 13. MCP server tools (`apps/mcp`)

Built in Z12. Not HTTP endpoints; listed so both sides agree. The MCP server calls the API with **her agent token**. The API enforces the Claude rules; the tools explain them to Claude.

**Routes an agent token may use (everything else: 403):** `POST /chat/draft`, `POST /questions` (`source: "mcp"`), `GET /questions/:id/status`, `POST /me/questions/:id/collect`, `GET /wallet`.

**Claude rules (server side):**

- Questions from Claude are stored with source `mcp`; emergencies are logged as `MCP`.
- **Claude's spending limit** (`mcpSpendingLimitPerAnswerKobo`, default ₦500) applies to drafts, `POST /questions` and collect, instead of her app limit. `approvedAboveLimit` is ignored for agent tokens: Claude cannot approve past Claude's limit, she raises it in the app.
- **"Ask before each payment"** (`mcpAskBeforeEachPayment`, default on): collecting a paid answer with an agent token answers 409 `PAYMENT_CONFIRMATION_REQUIRED` until the call sends `confirmPayment: true`. Free answers never ask.

| Tool                | Calls                                                                            | Behaviour                                                                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ask_health_worker` | `POST /chat/draft`, then (with `confirm: true` + `draftToken`) `POST /questions` | Step 1 returns the price (or free) and exactly what the nurse will see; nothing is sent. Step 2, only after she agreed, sends that signed draft, sharing `cleaned_text`, `category` and, if present, notes, age range and pregnancy weeks (never her raw words). Emergency → the same free guidance as the web app, nothing queued. |
| `get_answer`        | `GET /questions/:id/status`, then `POST /me/questions/:id/collect`               | Waiting / being answered / expired (not charged) / the answer. Pays over x402 from her CareLayer wallet within the Claude limit; asks first if `mcpAskBeforeEachPayment`. Never charges twice.                                                                                                                                      |
| `get_balance`       | `GET /wallet`                                                                    | Naira balance (USDC on Stellar) and free answers left.                                                                                                                                                                                                                                                                              |

**Transports:** stdio (`CARELAYER_AGENT_TOKEN` in the client's config), or hosted Streamable HTTP at `/mcp`, where each request sends `Authorization: Bearer clat_...` (stateless; the token is only passed on to the API). claude.ai web "custom connectors" need OAuth, which is not built.

## 14. Resolved questions (v0 → v1)

1. **Female preference:** hard filter. `femaleOnly` limits a question to nurses with gender `female`. Gender is optional on the profile.
2. **Nurses see `originalText`:** yes, when she consents to share it (`original_text` in `sharedFields`); otherwise `null`.
3. **Third-party agent identity:** `X-Question-Key` for v1. API keys can come later.
4. **MCP auth:** revocable agent token.
5. **Account per app:** yes, unique on (email, role).
6. **Answer price:** fixed ₦500 (`ANSWER_PRICE_KOBO=50000`).
7. **NGN/USDC rate:** fixed demo value `NGN_PER_USDC` (default 1600 in `.env.example`).
