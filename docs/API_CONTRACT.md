# CareLayer API Contract

> **v1 draft (Z1).** Aligned with the database schema and the decisions log in `docs/TASKS.md` §2. Hikmah reviews it in the Z1 PR; after sign-off, any change is a contract change: update this file **and** `packages/shared` in the same commit, and tell the other person.

Every type named here is exported from `@carelayer/shared` (`packages/shared/src`). If this doc and the types disagree, that is a bug: fix both.

## Changes from v0

**Renamed (`worker` → `nurse`). Hikmah: update mocks and imports.**

| v0                                          | v1                                               |
| ------------------------------------------- | ------------------------------------------------ |
| `UserRole` `'worker'`                       | `'nurse'`                                        |
| `AppAudience` `'workers'`                   | `'nurses'`; `AUTH_RULES.refreshTtlDays.nurses`   |
| `WorkerRole` (`nurse \| midwife \| doctor`) | `NurseRole` (`nurse \| midwife`). No doctors.    |
| `Regulator`, `REGULATOR_BY_ROLE`            | `NURSE_REGULATOR = 'NMCN'` (no MDCN)             |
| `WorkerGender`                              | `Gender`                                         |
| `WorkerProfile`                             | `NurseProfile`                                   |
| `WorkerDocument`, `WorkerDocumentType`      | `NurseDocument`, `NurseDocumentType`             |
| `UpdateWorkerProfileBody`                   | `UpdateNurseProfileBody`                         |
| `UpdateWorkerPreferencesBody`               | `UpdateNursePreferencesBody`                     |
| `WorkerQuestionView`                        | `NurseQuestionView`                              |
| `PublicWorker`, `Answer.worker`             | `PublicNurse` (adds `id`), `Answer.nurse`        |
| `AdminWorkerSummary`, `AdminWorkerDetail`   | `AdminNurseSummary`, `AdminNurseDetail`          |
| `RejectWorkerBody`                          | `RejectNurseBody`                                |
| `PAYOUT_SPLIT.workerBps`                    | `PAYOUT_SPLIT.nurseBps`                          |
| error `WORKER_NOT_APPROVED`                 | `NURSE_NOT_APPROVED`                             |
| `/worker/*` routes                          | `/nurse/*`                                       |
| `/admin/workers/*` routes                   | `/admin/nurses/*`                                |
| `PUT /worker/profile`                       | `PATCH /nurse/profile`                           |
| `CreateQuestionBody.preferFemaleWorker`     | `femaleOnly` (hard filter on nurse gender)       |
| `CreateQuestionBody.conversationId`         | removed (chat history is not stored server-side) |

**Added:** `QuestionStatus` `expired` and `cancelled`; `CreateQuestionBody.consent`, `nurseSelection`, `chosenNurseId`; `Answer.recommendSeeSomeoneToday`; `GET /nurses` + `NursePublicProfile`; `POST /questions/:id/feedback`; `GET/PATCH /me/notifications`; `NurseQuestionView.ageRange`, `pregnancyWeeks`, `chosenForYou`, `claimsCloseAt`; nurse `bio`, `languages`, `helpful`, `avgResponseMinutes`; `/health` reports the database and returns 503 when it is down; error codes `CONSENT_REQUIRED`, `CHOSEN_NURSE_UNAVAILABLE`, `QUESTION_EXPIRED`, `CLAIMS_CLOSED`.

**Known follow-ups:** the `docs/TASKS.md` screen map uses slightly different names for some routes (`POST /chat`, `PATCH /nurse/availability`, `GET /nurse/dashboard`). Each is reconciled in the task that builds it (Z6, Z7, Z9). Auth (Z3) and wallet (Z4) were reconciled: the contract names stay (`/auth/code/*`, `/wallet`), because `apps/web` already calls them.

**Z5 changes (top-ups):** **`TopupStatus` adds `"paid"`.** `TOPUP_LIMITS_KOBO` added to `@carelayer/shared`. Route names stay `/topups` (the TASKS.md screen map said `/me/topups`).

**Z4 changes (wallet):** **`WalletResponse` adds `status: "pending"|"active"` and `balanceSyncedAt`** (required). **`WalletTransaction` lists confirmed movements only.** `stellarExplorerUrl()` added to `@carelayer/shared`. Hikmah: `getWallet` in `apps/web/src/api/mock/mock-api.ts` needs the two new fields.

**Z3 changes (auth):** **`POST /auth/step-up` now returns `{ freshUntil }`** (the session is marked fresh; no `X-Step-Up-Token` header). **`AppAudience` adds `"admin"`** (log in only). **`VALIDATION_FAILED` adds `details.field`.** **New error `SERVICE_UNAVAILABLE` (503).** `AUTH_RULES` adds `resendAfterSeconds`, `maxCodesPerHour`, `refreshTtlDays.admin`, `refreshReuseGraceSeconds`. `/auth/logout` accepts the refresh cookie alone. `WRONG_APP` is no longer used (accounts are per app, so a woman's email in the nurse app is `ACCOUNT_NOT_FOUND`).

## 0. Conventions

| Item        | Rule                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL    | `http://localhost:4000` locally (`VITE_API_URL` in the frontends). No `/v1` prefix.                                                                                                                         |
| Format      | JSON in and out (`Content-Type: application/json`), except document uploads (multipart).                                                                                                                    |
| Auth        | `Authorization: Bearer <accessToken>`. Access tokens last ~15 min. The refresh token lives only in an httpOnly cookie.                                                                                      |
| Auth levels | **public**: no token. **woman** / **nurse** / **admin**: signed in with that role. **any**: any signed-in role. **agent**: signed-in woman, a woman's agent token, or a public agent with `X-Question-Key`. |
| Step-up     | Withdrawals and payout address changes need a code verified on the same session in the last 5 minutes (`POST /auth/step-up`), else 403 `STEP_UP_REQUIRED`.                                                  |
| Money       | `Money = { kobo: number, usdc: string }`. `kobo` is integer naira minor units (₦500 = `50000`). `usdc` is a decimal string with 7 places (stroops). Never floats.                                           |
| Price       | ₦500 per answer (`ANSWER_PRICE_KOBO`). Nurse 80% (₦400), platform 20%. Fixed demo rate `NGN_PER_USDC`.                                                                                                      |
| Times       | ISO 8601 UTC strings (`IsoDateTime`).                                                                                                                                                                       |
| Ids         | Opaque strings (`Id`).                                                                                                                                                                                      |
| Lists       | Cursor pages: `?cursor=&limit=` (default 20, max 100) returning `Page<T> = { items, nextCursor }`.                                                                                                          |
| Categories  | `pregnancy`, `periods`, `contraception`, `sexual_health`, `general` (`QuestionCategory`). Set by the AI only.                                                                                               |
| Privacy     | Never in any response to a nurse: the woman's name, email, phone, wallet or location. Never in any response to a woman: a nurse's email, phone or licence number.                                           |

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

| Method | Path                     | Auth             | Request                                                                                                                                                                                                                | Response                                                                                                                           | Errors                                                                                                                                                                                                                                                                                |
| ------ | ------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/code/request`     | public           | `RequestCodeBody` `{ email, purpose: "signup"\|"login"\|"step_up", app: "women"\|"nurses"\|"admin", name? }`. `name` required for signup (max 50 women, 100 nurses). `step_up` needs a bearer token and her own email. | 202 `RequestCodeResponse` `{ sent: true, resendAvailableAt }`                                                                      | 400 `VALIDATION_FAILED` (`details.field`); 403 `FORBIDDEN` (admin signup, step-up for another email); 409 `ACCOUNT_EXISTS` (signup); 404 `ACCOUNT_NOT_FOUND` (login); 429 `RATE_LIMITED` (`details.resendAvailableAt`, `retryAfterSeconds`); 503 `SERVICE_UNAVAILABLE` (email failed) |
| POST   | `/auth/code/verify`      | public           | `VerifyCodeBody` `{ email, code, purpose: "signup"\|"login", app, name?, deviceName? }`                                                                                                                                | 200 `AuthTokensResponse` `{ accessToken, accessTokenExpiresAt, user }` + `Set-Cookie: cl_refresh`                                  | 400 `CODE_INVALID` (`details.attemptsRemaining`); 410 `CODE_EXPIRED`; 429 `CODE_ATTEMPTS_EXCEEDED`; 409 `ACCOUNT_EXISTS`; 404 `ACCOUNT_NOT_FOUND`. A malformed request never uses up the code.                                                                                        |
| POST   | `/auth/google`           | public           | `GoogleAuthBody` `{ idToken, mode: "signup"\|"login", app, name?, deviceName? }`. First Google login links Google to an existing code account with the same email.                                                     | 200 `AuthTokensResponse` + cookie                                                                                                  | 401 `GOOGLE_TOKEN_INVALID` (invalid token, unverified email, or a different Google account than the one linked); 409 `ACCOUNT_EXISTS`; 404 `ACCOUNT_NOT_FOUND`; 503 `SERVICE_UNAVAILABLE` (Google not configured)                                                                     |
| POST   | `/auth/refresh`          | cookie           | none                                                                                                                                                                                                                   | 200 `AuthTokensResponse` + rotated cookie                                                                                          | 401 `REFRESH_INVALID`; 401 `REFRESH_REUSED` (session revoked). The cookie is cleared on any 401.                                                                                                                                                                                      |
| POST   | `/auth/logout`           | bearer or cookie | none                                                                                                                                                                                                                   | 204, cookie cleared, current session revoked. Works with an expired access token (uses the cookie) and is idempotent.              | none                                                                                                                                                                                                                                                                                  |
| POST   | `/auth/logout-all`       | any              | none                                                                                                                                                                                                                   | 204, every session for this user revoked                                                                                           | 401                                                                                                                                                                                                                                                                                   |
| GET    | `/auth/sessions`         | any              | none                                                                                                                                                                                                                   | 200 `SessionInfo[]` `{ id, deviceName, createdAt, lastUsedAt, current }`                                                           | 401                                                                                                                                                                                                                                                                                   |
| DELETE | `/auth/sessions/:id`     | any              | none                                                                                                                                                                                                                   | 204                                                                                                                                | 401; 404                                                                                                                                                                                                                                                                              |
| POST   | `/auth/step-up`          | any              | `StepUpBody` `{ code }` (code from `/auth/code/request` with `purpose: "step_up"`)                                                                                                                                     | 200 `StepUpResponse` `{ freshUntil }`: this session may withdraw / change the payout address until then (5 min). No token to send. | 400 `CODE_INVALID`; 410 `CODE_EXPIRED`; 429 `CODE_ATTEMPTS_EXCEEDED`                                                                                                                                                                                                                  |
| POST   | `/auth/agent-tokens`     | woman            | `CreateAgentTokenBody` `{ label }`                                                                                                                                                                                     | 201 `CreateAgentTokenResponse` `{ id, label, token, createdAt }` (token shown once)                                                | 401                                                                                                                                                                                                                                                                                   |
| DELETE | `/auth/agent-tokens/:id` | woman            | none                                                                                                                                                                                                                   | 204                                                                                                                                | 401; 404                                                                                                                                                                                                                                                                              |

## 3. Users, settings and notifications

| Method | Path                | Auth  | Request                                                       | Response                                                                                                                                 | Errors   |
| ------ | ------------------- | ----- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| GET    | `/me`               | any   | none                                                          | 200 `User` `{ id, role: "woman"\|"nurse"\|"admin", displayName, email, createdAt }`                                                      | 401      |
| PATCH  | `/me`               | any   | `UpdateMeBody` `{ displayName? }`                             | 200 `User`                                                                                                                               | 400; 401 |
| GET    | `/me/settings`      | any   | none                                                          | 200 `UserSettings` `{ appearance, quickExitTarget, spendingLimitPerAnswerKobo, mcpSpendingLimitPerAnswerKobo, mcpAskBeforeEachPayment }` | 401      |
| PATCH  | `/me/settings`      | any   | `UpdateSettingsBody` (any subset of `UserSettings`)           | 200 `UserSettings`                                                                                                                       | 400; 401 |
| GET    | `/me/notifications` | woman | none                                                          | 200 `NotificationPreferences` `{ notifyWhenAnswered }`                                                                                   | 401      |
| PATCH  | `/me/notifications` | woman | `UpdateNotificationPreferencesBody` `{ notifyWhenAnswered? }` | 200 `NotificationPreferences`                                                                                                            | 400; 401 |

Women-only settings are ignored for nurses. `appearance` is also kept in `localStorage` so the theme applies before sign-in. Notifications are **email only** (no push).

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

Every chat message and every `POST /questions` is checked **first** against `apps/api/config/red-flags.json` plus the LLM. On a match the endpoint returns `EmergencyResponse` instead of its normal result. Free. Nothing is queued, no question is created. The server logs an `EmergencyEvent` with **source and timestamp only** (no user, no text, no red-flag id).

```ts
EmergencyResponse = { kind: "emergency", message, triggeredBy: string[], contacts: EmergencyContact[], findHospitalUrl }
EmergencyContact  = { label, number, verified }
```

| Method | Path         | Auth   | Request | Response                                                                                              | Errors |
| ------ | ------------ | ------ | ------- | ----------------------------------------------------------------------------------------------------- | ------ |
| GET    | `/emergency` | public | none    | 200 `EmergencyResponse` (static content, `triggeredBy: []`) for clients that want to show it directly | none   |

Emergency numbers must be verified (`verified: true`) before the demo.

## 7. Chat (AI assistant, free)

> **Superseded by the decisions log: chat history is not stored on the server.** Z6 replaces the conversation endpoints below with a single stateless `POST /chat` (history sent by the client; returns an answer, an offer with a draft, or an emergency). Until Z6 lands, treat this section as provisional.

| Method | Path                               | Auth  | Request                      | Response                                                                                                                        | Errors             |
| ------ | ---------------------------------- | ----- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| POST   | `/chat/conversations`              | woman | none                         | 201 `Conversation` (empty `messages`)                                                                                           | 401                |
| GET    | `/chat/conversations`              | woman | `PageQuery`                  | 200 `Page<Conversation>` (messages omitted or last only)                                                                        | 401                |
| GET    | `/chat/conversations/:id`          | woman | none                         | 200 `Conversation`                                                                                                              | 401; 404           |
| POST   | `/chat/conversations/:id/messages` | woman | `SendMessageBody` `{ text }` | 200 `SendMessageResponse`: either `{ kind: "reply", message, escalationOffer: EscalationOffer \| null }` or `EmergencyResponse` | 400; 401; 404; 429 |

`EscalationOffer = { price, isFree, freeAnswersRemaining, suggestedCategory, exceedsSpendingLimit }`.

## 8. Questions (agent-facing, x402 pay on delivery)

Any agent can call these: our web app (through the API's own agent), Claude via `apps/mcp`, or third-party apps.

### 8.0 Nurse directory (W08 "Choose who answers")

| Method | Path      | Auth  | Request                                | Response                                                                                                                                                                                                           | Errors   |
| ------ | --------- | ----- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| GET    | `/nurses` | agent | `NurseListQuery` `?topic=&femaleOnly=` | 200 `NursePublicProfile[]`: approved, available nurses only. `{ id, fullName, role, gender, yearsOfPractice, bio, languages, topics, available, verified: true, avgResponseMinutes, helpful: { percent, count } }` | 400; 401 |

Rating is "% helpful + count" (e.g. "96% helpful (212)"); `percent` is null until the first feedback. No stars. No email, phone or licence number.

### 8.1 Create

| Method | Path         | Auth  | Request                                                                                                                                                                                                                 | Response                                                                                                                                                                                     | Errors                                                                                                                                                                     |
| ------ | ------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/questions` | agent | `CreateQuestionBody` `{ originalText, source: "web"\|"mcp"\|"agent", consent: { sharedFields, consentVersion }, nurseSelection?: "first_available"\|"chosen_nurse", chosenNurseId?, femaleOnly?, approvedAboveLimit? }` | 201 `CreatedQuestion` `{ kind: "question", id, status: "open", category, price, isFree, nurseSelection, chosenUntil, claimsCloseAt, questionKey, createdAt }` **or** 200 `EmergencyResponse` | 400 `VALIDATION_FAILED` / `CONSENT_REQUIRED`; 401; 409 `SPENDING_LIMIT_EXCEEDED` (price above her limit and `approvedAboveLimit` not true); 409 `CHOSEN_NURSE_UNAVAILABLE` |

`SharedField` = `cleaned_text | original_text | assistant_notes | category | age_range | pregnancy_weeks`. Never her name, email, phone or location.

Server behaviour:

1. Red-flag check first (see §6).
2. Consent is required and stored per question (fields shared, consent text version, time).
3. Store `originalText` **verbatim**.
4. LLM produces `cleanedText`: spelling and grammar only, **never summarised or shortened**. It may add separate `assistantNotes`, and extracts `ageRange` / `pregnancyWeeks` only when she mentioned them. (Z6 may move this into the chat draft.)
5. LLM assigns `category`.
6. **Selection.** `first_available` (default): any eligible nurse. `chosen_nurse`: `chosenNurseId` must be an approved, available nurse (and female if `femaleOnly`). She alone can see and claim it until `chosenUntil` (created + 10 min); after that, or if she releases or her claim expires, it opens to everyone.
7. **`femaleOnly`**: only nurses with gender `female` can see or claim it.
8. **Expiry.** `claimsCloseAt` = created + 30 min. No new claims after that. An active claim may finish its 10-minute lock (max wait 40 min). Unanswered → `expired`, she pays nothing.
9. `isFree` is true while she has free answers left (first 3). It is a quote: the final charge is decided when she collects the answer. Third-party agents without a CareLayer account always pay.
10. `questionKey` is returned only to callers without a CareLayer session; they send it as `X-Question-Key` afterwards.

### 8.2 Status

| Method | Path                    | Auth          | Request | Response                                                                                                                                             | Errors   |
| ------ | ----------------------- | ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| GET    | `/questions/:id/status` | agent (owner) | none    | 200 `QuestionStatusResponse` `{ id, status: "open"\|"claimed"\|"answered"\|"expired"\|"cancelled", category, claimsCloseAt, answeredAt, expiredAt }` | 401; 404 |

### 8.3 Answer (x402-protected)

| Method | Path                    | Auth                         | Request                      | Response                                                                                        | Errors                                                                                                                       |
| ------ | ----------------------- | ---------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/questions/:id/answer` | agent (owner) + x402 payment | x402 payment header on retry | 200 `AnswerResponse` `{ answer: Answer, payment: { amount, stellarTxHash, paidFromTreasury } }` | 404; **409 `QUESTION_NOT_ANSWERED`** (guard, runs before payment); 410 `QUESTION_EXPIRED`; **402** x402 payment requirements |

x402 details (decided in Z2, see the decisions log in `docs/TASKS.md`): official `@x402/*` packages, OpenZeppelin Channels facilitator, network `stellar:testnet`, asset = testnet USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, amount in stroops. Headers: `PAYMENT-REQUIRED` on the 402 (base64 JSON), `PAYMENT-SIGNATURE` on the paid retry, `PAYMENT-RESPONSE` on the 200 (base64 JSON with the settlement `transaction` hash). The facilitator sponsors fees: the payer spends only the USDC price.

Order of middleware is part of the contract:

1. **Owner check** (404 if not hers).
2. **Answered guard**: if not answered, return 409 `QUESTION_NOT_ANSWERED` (410 `QUESTION_EXPIRED` if expired). Unanswered questions never request payment.
3. **x402 payment middleware**: returns 402 with payment requirements (USDC on Stellar testnet, `payTo` = platform address, amount = price). Header names and payload follow the current x402 spec: check the official docs before implementing.
4. **Settle and split**: 80% to the nurse, 20% platform (`PAYOUT_SPLIT`). Free answers: she pays nothing and the treasury pays the nurse's 80%, `paidFromTreasury: true`. Both transaction hashes are stored. Idempotent: a repeated fetch never charges or pays twice.

`Answer = { questionId, text, nurse: PublicNurse, recommendSeeSomeoneToday, answeredAt }`. `PublicNurse = { id, displayName, role, verified: true }`. **No contact details, ever.**

### 8.4 Her questions and feedback (web app)

| Method | Path                        | Auth  | Request                      | Response                                                                                                                                           | Errors                                                                                 |
| ------ | --------------------------- | ----- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/me/questions`             | woman | `?status=` + `PageQuery`     | 200 `Page<MyQuestion>`                                                                                                                             | 401                                                                                    |
| GET    | `/me/questions/:id`         | woman | none                         | 200 `MyQuestion`                                                                                                                                   | 401; 404                                                                               |
| POST   | `/me/questions/:id/collect` | woman | none                         | 200 `AnswerResponse`. The API's own agent calls `GET /questions/:id/answer`, paying over x402 from her custodial wallet (or the treasury if free). | 409 `QUESTION_NOT_ANSWERED`; 409 `INSUFFICIENT_BALANCE`; 409 `SPENDING_LIMIT_EXCEEDED` |
| POST   | `/questions/:id/feedback`   | woman | `FeedbackBody` `{ helpful }` | 200 `FeedbackResponse` `{ questionId, helpful, updatedAt }`. One per answer; sending again changes it. Updates the nurse's % helpful.              | 400; 401; 404; 409 `QUESTION_NOT_ANSWERED`                                             |

`MyQuestion = { id, status, category, originalText, cleanedText, price, isFree, nurseSelection, chosenNurse, femaleOnly, claimsCloseAt, answer, feedback, createdAt }`.

## 9. Claiming and answering (nurses)

Only `approved` nurses can claim. One active claim per nurse and per question (enforced by the database). 10-minute lock (`CLAIM_LOCK_MINUTES`). Expired or released claims return the question to `open`.

**Visibility ("Waiting" tab).** An open question is visible to a nurse when: she is approved; `femaleOnly` is false or her gender is `female`; and either the question has no chosen nurse, the chosen window has passed, or she is the chosen nurse. Topics control **alerts only**: all eligible open questions stay visible.

| Method | Path                           | Auth  | Request                                                           | Response                                                                                 | Errors                                                                                                                                             |
| ------ | ------------------------------ | ----- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/nurse/questions`             | nurse | `?tab=waiting\|active\|completed` (default waiting) + `PageQuery` | 200 `Page<NurseQuestionView>`                                                            | 401; 403 `NURSE_NOT_APPROVED`                                                                                                                      |
| GET    | `/nurse/questions/:id`         | nurse | none                                                              | 200 `NurseQuestionView`                                                                  | 401; 404                                                                                                                                           |
| GET    | `/nurse/claim`                 | nurse | none                                                              | 200 `NurseQuestionView \| null` (current claim, with `claimExpiresAt` for the countdown) | 401                                                                                                                                                |
| POST   | `/nurse/questions/:id/claim`   | nurse | none                                                              | 200 `Claim` `{ questionId, expiresAt }`                                                  | 403 `NURSE_NOT_APPROVED`; 409 `QUESTION_ALREADY_CLAIMED`; 409 `ACTIVE_CLAIM_EXISTS`; 409 `CLAIMS_CLOSED` (after 30 min); 404 if not visible to her |
| POST   | `/nurse/questions/:id/release` | nurse | none                                                              | 204 (question back to `open`; a chosen-nurse question opens to everyone)                 | 403 `NOT_CLAIM_OWNER`; 410 `CLAIM_EXPIRED`                                                                                                         |
| POST   | `/nurse/questions/:id/answer`  | nurse | `SubmitAnswerBody` `{ text, recommendSeeSomeoneToday? }`          | 201 `Answer`                                                                             | 400; 403 `NOT_CLAIM_OWNER`; 410 `CLAIM_EXPIRED`                                                                                                    |

`NurseQuestionView = { id, status, category, cleanedText, originalText (null if not shared), assistantNotes, ageRange, pregnancyWeeks, femaleOnly, chosenForYou, claimsCloseAt, createdAt, claimExpiresAt }`. The woman is anonymous: no name, email, wallet, location or chat history.

## 10. Nurse onboarding and profile

| Method | Path                    | Auth            | Request                                                                                                                                                                    | Response                                                       | Errors                                                          |
| ------ | ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| GET    | `/nurse/profile`        | nurse           | none                                                                                                                                                                       | 200 `NurseProfile`                                             | 401                                                             |
| PATCH  | `/nurse/profile`        | nurse           | `UpdateNurseProfileBody` `{ role?, fullNameConfirmed?, gender?, practiceArea?, yearsOfPractice?, bio? (≤280), languages?, licenceNumber?, guidanceNotDiagnosisAccepted? }` | 200 `NurseProfile` (`topics` defaulted from role on first set) | 400; 401; 409 if already `approved` and changing licence fields |
| POST   | `/nurse/documents`      | nurse           | multipart: `type` (`NurseDocumentType`), `file` (image/PDF, max 10 MB)                                                                                                     | 201 `NurseDocument`. Private storage, never a public URL.      | 400; 401                                                        |
| DELETE | `/nurse/documents/:id`  | nurse           | none                                                                                                                                                                       | 204                                                            | 401; 404; 409 if `pending_review`/`approved`                    |
| POST   | `/nurse/profile/submit` | nurse           | none                                                                                                                                                                       | 200 `NurseProfile` with `verificationStatus: "pending_review"` | 409 `ONBOARDING_INCOMPLETE` (`details.missing: string[]`)       |
| PATCH  | `/nurse/preferences`    | nurse           | `UpdateNursePreferencesBody` `{ topics?, available? }`                                                                                                                     | 200 `NurseProfile`                                             | 400 `TOPICS_REQUIRED` (empty topics)                            |
| PUT    | `/nurse/payout-address` | nurse + step-up | `UpdatePayoutAddressBody` `{ stellarAddress \| null }`                                                                                                                     | 200 `NurseProfile`                                             | 400 `STELLAR_ADDRESS_INVALID`; 403 `STEP_UP_REQUIRED`           |

Roles: `nurse` or `midwife` only. All are registered with the Nursing and Midwifery Council of Nigeria (`NURSE_REGULATOR = "NMCN"`). Topic defaults (`DEFAULT_TOPICS_BY_ROLE`): midwives get Pregnancy + Periods; nurses get all. Languages from a fixed list: `english`, `pidgin`, `yoruba`, `hausa`, `igbo`.

Required to submit: role, full name confirmed, years, licence number, all four documents (`practising_licence`, `registration_certificate`, `government_id`, `selfie_with_id`), guidance-not-diagnosis agreement.

## 11. Admin verification

| Method | Path                        | Auth  | Request                                          | Response                                                              | Errors                                |
| ------ | --------------------------- | ----- | ------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------- |
| GET    | `/admin/nurses`             | admin | `?status=pending_review` (default) + `PageQuery` | 200 `Page<AdminNurseSummary>`                                         | 401; 403                              |
| GET    | `/admin/nurses/:id`         | admin | none                                             | 200 `AdminNurseDetail` (profile + email + short-lived `documentUrls`) | 401; 403; 404                         |
| POST   | `/admin/nurses/:id/approve` | admin | none                                             | 200 `AdminNurseSummary` (`approved`)                                  | 403; 404; 409 if not `pending_review` |
| POST   | `/admin/nurses/:id/reject`  | admin | `RejectNurseBody` `{ reason }`                   | 200 `AdminNurseSummary` (`rejected`)                                  | 400; 403; 404                         |

Admin checks the licence manually against the NMCN register.

## 12. Earnings and withdrawals (nurses)

| Method | Path                 | Auth            | Request                                                                            | Response                                                                                                       | Errors                                                                                                         |
| ------ | -------------------- | --------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/nurse/earnings`    | nurse           | none                                                                               | 200 `EarningsResponse` `{ balance, totalEarned, answersCount, recent: EarningEntry[] }`                        | 401                                                                                                            |
| GET    | `/nurse/withdrawals` | nurse           | `PageQuery`                                                                        | 200 `Page<Withdrawal>`                                                                                         | 401                                                                                                            |
| POST   | `/nurse/withdrawals` | nurse + step-up | `CreateWithdrawalBody` `{ amountKobo, destination: { kind: "stellar", address } }` | 201 `Withdrawal` `{ id, status, amount, destinationAddress, stellarTxHash, createdAt }` (real testnet payment) | 400 `STELLAR_ADDRESS_INVALID`; 403 `STEP_UP_REQUIRED`; 409 `INSUFFICIENT_BALANCE`; 502 `STELLAR_SUBMIT_FAILED` |

Bank withdrawal: UI shows "Coming soon". No endpoint.

## 13. MCP server tools (`apps/mcp`)

Not HTTP endpoints, listed so both sides agree. The MCP server calls the API with a woman's agent token (`POST /auth/agent-tokens`) and is bound by `mcpSpendingLimitPerAnswerKobo` and `mcpAskBeforeEachPayment`.

| Tool                | Calls                                                         | Notes                                                                                                                           |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ask_health_worker` | `POST /questions` (`source: "mcp"`)                           | Requires explicit confirmation of the price in the tool input. Emergency → returns the free emergency response, nothing queued. |
| `get_answer`        | `GET /questions/:id/status`, then `GET /questions/:id/answer` | Pays over x402 from her CareLayer wallet within the Claude limit. Asks first if `mcpAskBeforeEachPayment`.                      |
| `get_balance`       | `GET /wallet`                                                 | Shows naira balance and free answers left.                                                                                      |

## 14. Resolved questions (v0 → v1)

1. **Female preference:** hard filter. `femaleOnly` limits a question to nurses with gender `female`. Gender is optional on the profile.
2. **Nurses see `originalText`:** yes, when she consents to share it (`original_text` in `sharedFields`); otherwise `null`.
3. **Third-party agent identity:** `X-Question-Key` for v1. API keys can come later.
4. **MCP auth:** revocable agent token.
5. **Account per app:** yes, unique on (email, role).
6. **Answer price:** fixed ₦500 (`ANSWER_PRICE_KOBO=50000`).
7. **NGN/USDC rate:** fixed demo value `NGN_PER_USDC` (default 1600 in `.env.example`).
