# CareLayer API Contract

> **v0: agree before building.** Zainab and Hikmah review this together and sign off before either side builds against it. After sign-off, any change is a contract change: update this file **and** `packages/shared` in the same commit, and tell the other person.

Every type named here is exported from `@carelayer/shared` (`packages/shared/src`). If this doc and the types disagree, that is a bug: fix both.

## 0. Conventions

| Item        | Rule                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base URL    | `http://localhost:4000` locally (`VITE_API_URL` in the frontends). No `/v1` prefix in v0.                                                                                                                    |
| Format      | JSON in and out (`Content-Type: application/json`), except document uploads (multipart).                                                                                                                     |
| Auth        | `Authorization: Bearer <accessToken>`. Access tokens last ~15 min. The refresh token lives only in an httpOnly cookie.                                                                                       |
| Auth levels | **public**: no token. **woman** / **worker** / **admin**: signed in with that role. **any**: any signed-in role. **agent**: signed-in woman, a woman's agent token, or a public agent with `X-Question-Key`. |
| Step-up     | Withdrawals and payout address changes also need `X-Step-Up-Token` (from `POST /auth/step-up`, ~5 min).                                                                                                      |
| Money       | `Money = { kobo: number, usdc: string }`. `kobo` is integer naira minor units (₦500 = `50000`). `usdc` is a decimal string, up to 7 places. Never floats for USDC.                                           |
| Times       | ISO 8601 UTC strings (`IsoDateTime`).                                                                                                                                                                        |
| Ids         | Opaque strings (`Id`).                                                                                                                                                                                       |
| Lists       | Cursor pages: `?cursor=&limit=` (default 20, max 100) returning `Page<T> = { items, nextCursor }`.                                                                                                           |
| Categories  | `pregnancy`, `periods`, `contraception`, `sexual_health`, `general` (`QuestionCategory`). Set by the AI only.                                                                                                |

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

| HTTP      | Typical codes                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400       | `VALIDATION_FAILED`, `CODE_INVALID`, `STELLAR_ADDRESS_INVALID`, `TOPICS_REQUIRED`                                                                                                    |
| 401       | `UNAUTHENTICATED`, `REFRESH_INVALID`, `REFRESH_REUSED`, `GOOGLE_TOKEN_INVALID`                                                                                                       |
| 402       | x402 payment required (see §8.3). Not an `ApiErrorBody`.                                                                                                                             |
| 403       | `FORBIDDEN`, `WRONG_APP`, `STEP_UP_REQUIRED`, `WORKER_NOT_APPROVED`, `NOT_CLAIM_OWNER`                                                                                               |
| 404       | `NOT_FOUND`, `ACCOUNT_NOT_FOUND`                                                                                                                                                     |
| 409       | `CONFLICT`, `ACCOUNT_EXISTS`, `QUESTION_NOT_ANSWERED`, `QUESTION_ALREADY_CLAIMED`, `ACTIVE_CLAIM_EXISTS`, `SPENDING_LIMIT_EXCEEDED`, `INSUFFICIENT_BALANCE`, `ONBOARDING_INCOMPLETE` |
| 410       | `CODE_EXPIRED`, `CLAIM_EXPIRED`                                                                                                                                                      |
| 429       | `RATE_LIMITED`, `CODE_ATTEMPTS_EXCEEDED`                                                                                                                                             |
| 500 / 502 | `INTERNAL`, `STELLAR_SUBMIT_FAILED`                                                                                                                                                  |

## 1. Health

| Method | Path      | Auth   | Request | Response                                                                                   | Errors |
| ------ | --------- | ------ | ------- | ------------------------------------------------------------------------------------------ | ------ |
| GET    | `/health` | public | none    | `HealthResponse` `{ status: "ok", service: "carelayer-api", contractVersion: "v0", time }` | none   |

## 2. Auth (passwordless)

Rules (`AUTH_RULES`): 6-digit code, 10-min expiry, single use, stored hashed, max 5 attempts, resend rate-limited. Access token ~15 min. Refresh cookie ~90 days (women) / ~30 days (workers), sliding, rotated on every refresh, reuse detection revokes the whole session. Accounts are per app (`app: "women" | "workers"`).

Refresh cookie: `cl_refresh`, `HttpOnly; Secure; SameSite=Lax; Path=/auth`. (Lax, not Strict, so it survives the Google redirect.)

| Method | Path                     | Auth   | Request                                                                                                                                       | Response                                                                                          | Errors                                                                                                              |
| ------ | ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/code/request`     | public | `RequestCodeBody` `{ email, purpose: "signup"\|"login"\|"step_up", app, name? }`. `name` required for signup. `step_up` needs a bearer token. | 202 `RequestCodeResponse` `{ sent: true, resendAvailableAt }`                                     | 400 `VALIDATION_FAILED`; 409 `ACCOUNT_EXISTS` (signup); 404 `ACCOUNT_NOT_FOUND` (login); 429 `RATE_LIMITED`         |
| POST   | `/auth/code/verify`      | public | `VerifyCodeBody` `{ email, code, purpose: "signup"\|"login", app, name?, deviceName? }`                                                       | 200 `AuthTokensResponse` `{ accessToken, accessTokenExpiresAt, user }` + `Set-Cookie: cl_refresh` | 400 `CODE_INVALID` (`details.attemptsRemaining`); 410 `CODE_EXPIRED`; 429 `CODE_ATTEMPTS_EXCEEDED`; 403 `WRONG_APP` |
| POST   | `/auth/google`           | public | `GoogleAuthBody` `{ idToken, mode: "signup"\|"login", app, name?, deviceName? }`                                                              | 200 `AuthTokensResponse` + cookie                                                                 | 401 `GOOGLE_TOKEN_INVALID`; 409 `ACCOUNT_EXISTS`; 404 `ACCOUNT_NOT_FOUND`; 403 `WRONG_APP`                          |
| POST   | `/auth/refresh`          | cookie | none                                                                                                                                          | 200 `AuthTokensResponse` + rotated cookie                                                         | 401 `REFRESH_INVALID`; 401 `REFRESH_REUSED` (session family revoked)                                                |
| POST   | `/auth/logout`           | any    | none                                                                                                                                          | 204, cookie cleared, current session revoked                                                      | 401                                                                                                                 |
| POST   | `/auth/logout-all`       | any    | none                                                                                                                                          | 204, every session for this user revoked                                                          | 401                                                                                                                 |
| GET    | `/auth/sessions`         | any    | none                                                                                                                                          | 200 `SessionInfo[]` `{ id, deviceName, createdAt, lastUsedAt, current }`                          | 401                                                                                                                 |
| DELETE | `/auth/sessions/:id`     | any    | none                                                                                                                                          | 204                                                                                               | 401; 404                                                                                                            |
| POST   | `/auth/step-up`          | any    | `StepUpBody` `{ code }` (code from `/auth/code/request` with `purpose: "step_up"`)                                                            | 200 `StepUpResponse` `{ stepUpToken, expiresAt }`                                                 | 400 `CODE_INVALID`; 410 `CODE_EXPIRED`; 429                                                                         |
| POST   | `/auth/agent-tokens`     | woman  | `CreateAgentTokenBody` `{ label }`                                                                                                            | 201 `CreateAgentTokenResponse` `{ id, label, token, createdAt }` (token shown once)               | 401                                                                                                                 |
| DELETE | `/auth/agent-tokens/:id` | woman  | none                                                                                                                                          | 204                                                                                               | 401; 404                                                                                                            |

## 3. Users and settings

| Method | Path           | Auth | Request                                             | Response                                                                                                                                 | Errors   |
| ------ | -------------- | ---- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| GET    | `/me`          | any  | none                                                | 200 `User` `{ id, role, displayName, email, createdAt }`                                                                                 | 401      |
| PATCH  | `/me`          | any  | `UpdateMeBody` `{ displayName? }`                   | 200 `User`                                                                                                                               | 400; 401 |
| GET    | `/me/settings` | any  | none                                                | 200 `UserSettings` `{ appearance, quickExitTarget, spendingLimitPerAnswerKobo, mcpSpendingLimitPerAnswerKobo, mcpAskBeforeEachPayment }` | 401      |
| PATCH  | `/me/settings` | any  | `UpdateSettingsBody` (any subset of `UserSettings`) | 200 `UserSettings`                                                                                                                       | 400; 401 |

Women-only fields are ignored for workers. `appearance` is also kept in `localStorage` so the theme applies before sign-in.

## 4. Wallet

Custodial Stellar testnet wallet created at sign-up for every user. Keys never leave the server. Shown in naira.

| Method | Path                   | Auth | Request     | Response                                                                        | Errors |
| ------ | ---------------------- | ---- | ----------- | ------------------------------------------------------------------------------- | ------ |
| GET    | `/wallet`              | any  | none        | 200 `WalletResponse` `{ stellarAddress, balance: Money, freeAnswersRemaining }` | 401    |
| GET    | `/wallet/transactions` | any  | `PageQuery` | 200 `Page<WalletTransaction>`                                                   | 401    |

There is **no** withdraw endpoint for women.

## 5. Top-up (Paystack TEST mode)

| Method | Path                 | Auth                                        | Request                            | Response                                                                                        | Errors                           |
| ------ | -------------------- | ------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------- |
| POST   | `/topups`            | woman                                       | `CreateTopupBody` `{ amountKobo }` | 201 `CreateTopupResponse` `{ topupId, reference, authorizationUrl }`                            | 400; 401                         |
| GET    | `/topups/:id`        | woman                                       | none                               | 200 `Topup` `{ id, status: "pending"\|"credited"\|"failed", amount, stellarTxHash, createdAt }` | 401; 404                         |
| POST   | `/webhooks/paystack` | Paystack signature (`x-paystack-signature`) | Paystack event                     | 200 (idempotent on `reference`). On `charge.success`, credit test USDC to her wallet.           | 401 `PAYSTACK_SIGNATURE_INVALID` |

## 6. Emergencies

Every chat message and every `POST /questions` is checked **first** against `apps/api/config/red-flags.json` plus the LLM. On a match the endpoint returns `EmergencyResponse` instead of its normal result. Free. Nothing is queued.

```ts
EmergencyResponse = { kind: "emergency", message, triggeredBy: string[], contacts: EmergencyContact[], findHospitalUrl }
EmergencyContact  = { label, number, verified }
```

| Method | Path         | Auth   | Request | Response                                                                                              | Errors |
| ------ | ------------ | ------ | ------- | ----------------------------------------------------------------------------------------------------- | ------ |
| GET    | `/emergency` | public | none    | 200 `EmergencyResponse` (static content, `triggeredBy: []`) for clients that want to show it directly | none   |

Emergency numbers must be verified (`verified: true`) before the demo.

## 7. Chat (AI assistant, free)

| Method | Path                               | Auth  | Request                      | Response                                                                                                                        | Errors             |
| ------ | ---------------------------------- | ----- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| POST   | `/chat/conversations`              | woman | none                         | 201 `Conversation` (empty `messages`)                                                                                           | 401                |
| GET    | `/chat/conversations`              | woman | `PageQuery`                  | 200 `Page<Conversation>` (messages omitted or last only)                                                                        | 401                |
| GET    | `/chat/conversations/:id`          | woman | none                         | 200 `Conversation`                                                                                                              | 401; 404           |
| POST   | `/chat/conversations/:id/messages` | woman | `SendMessageBody` `{ text }` | 200 `SendMessageResponse`: either `{ kind: "reply", message, escalationOffer: EscalationOffer \| null }` or `EmergencyResponse` | 400; 401; 404; 429 |

`EscalationOffer = { price, isFree, freeAnswersRemaining, suggestedCategory, exceedsSpendingLimit }`. The UI shows price, free answers left, "prefer a female health worker", **Send** / **Not now**. "Ask a health worker directly" skips the offer and calls `POST /questions`.

## 8. Questions (agent-facing, x402 pay on delivery)

Any agent can call these: our web app (through the API's own agent), Claude via `apps/mcp`, or third-party apps.

### 8.1 Create

| Method | Path         | Auth  | Request                                                                                                                           | Response                                                                                                                                         | Errors                                                                                            |
| ------ | ------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| POST   | `/questions` | agent | `CreateQuestionBody` `{ originalText, conversationId?, preferFemaleWorker?, source: "web"\|"mcp"\|"agent", approvedAboveLimit? }` | 201 `CreatedQuestion` `{ kind: "question", id, status: "open", category, price, isFree, questionKey, createdAt }` **or** 200 `EmergencyResponse` | 400; 401; 409 `SPENDING_LIMIT_EXCEEDED` (price above her limit and `approvedAboveLimit` not true) |

Server behaviour:

1. Red-flag check first (see §6).
2. Store `originalText` **verbatim**.
3. LLM produces `cleanedText`: spelling and grammar only, **never summarised or shortened**.
4. LLM may add separate `assistantNotes`.
5. LLM assigns `category`.
6. `isFree` is true while she has free answers left (first 3). Third-party agents without a CareLayer account always pay.
7. `questionKey` is returned only to callers without a CareLayer session; they send it as `X-Question-Key` afterwards.

### 8.2 Status

| Method | Path                    | Auth          | Request | Response                                                                                           | Errors   |
| ------ | ----------------------- | ------------- | ------- | -------------------------------------------------------------------------------------------------- | -------- |
| GET    | `/questions/:id/status` | agent (owner) | none    | 200 `QuestionStatusResponse` `{ id, status: "open"\|"claimed"\|"answered", category, answeredAt }` | 401; 404 |

### 8.3 Answer (x402-protected)

| Method | Path                    | Auth                         | Request                      | Response                                                                                        | Errors                                                                                               |
| ------ | ----------------------- | ---------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/questions/:id/answer` | agent (owner) + x402 payment | x402 payment header on retry | 200 `AnswerResponse` `{ answer: Answer, payment: { amount, stellarTxHash, paidFromTreasury } }` | 404; **409 `QUESTION_NOT_ANSWERED`** (guard, runs before payment); **402** x402 payment requirements |

Order of middleware is part of the contract:

1. **Owner check** (404 if not hers).
2. **Answered guard**: if not answered, return 409 `QUESTION_NOT_ANSWERED`. Unanswered questions never request payment.
3. **x402 payment middleware**: returns 402 with payment requirements (USDC on Stellar testnet, `payTo` = platform address, amount = price). Header names and payload follow the current x402 spec: check the official docs before implementing.
4. **Settle and split**: 80% to the health worker, 20% platform (`PAYOUT_SPLIT`). Free answers: the treasury pays the worker's 80%, `paidFromTreasury: true`.

`Answer = { questionId, text, worker: PublicWorker, answeredAt }`. `PublicWorker = { displayName, role, verified: true }`. **No contact details, ever.**

### 8.4 Her questions (web app)

| Method | Path                        | Auth  | Request     | Response                                                                                                                                           | Errors                                                                                 |
| ------ | --------------------------- | ----- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/me/questions`             | woman | `PageQuery` | 200 `Page<MyQuestion>`                                                                                                                             | 401                                                                                    |
| GET    | `/me/questions/:id`         | woman | none        | 200 `MyQuestion`                                                                                                                                   | 401; 404                                                                               |
| POST   | `/me/questions/:id/collect` | woman | none        | 200 `AnswerResponse`. The API's own agent calls `GET /questions/:id/answer`, paying over x402 from her custodial wallet (or the treasury if free). | 409 `QUESTION_NOT_ANSWERED`; 409 `INSUFFICIENT_BALANCE`; 409 `SPENDING_LIMIT_EXCEEDED` |

`MyQuestion = { id, status, category, originalText, cleanedText, price, isFree, answer, createdAt }`.

## 9. Claiming and answering (health workers)

Only `approved` workers can claim. One active claim per worker. 10-minute lock (`CLAIM_LOCK_MINUTES`). Expired claims return to `open`.

| Method | Path                            | Auth   | Request                                | Response                                                                                  | Errors                                                                               |
| ------ | ------------------------------- | ------ | -------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/worker/questions`             | worker | `?status=open` (default) + `PageQuery` | 200 `Page<WorkerQuestionView>`. All open questions are visible regardless of topics.      | 401                                                                                  |
| GET    | `/worker/questions/:id`         | worker | none                                   | 200 `WorkerQuestionView`                                                                  | 401; 404                                                                             |
| GET    | `/worker/claim`                 | worker | none                                   | 200 `WorkerQuestionView \| null` (current claim, with `claimExpiresAt` for the countdown) | 401                                                                                  |
| POST   | `/worker/questions/:id/claim`   | worker | none                                   | 200 `Claim` `{ questionId, expiresAt }`                                                   | 403 `WORKER_NOT_APPROVED`; 409 `QUESTION_ALREADY_CLAIMED`; 409 `ACTIVE_CLAIM_EXISTS` |
| POST   | `/worker/questions/:id/release` | worker | none                                   | 204 (question back to `open`)                                                             | 403 `NOT_CLAIM_OWNER`; 410 `CLAIM_EXPIRED`                                           |
| POST   | `/worker/questions/:id/answer`  | worker | `SubmitAnswerBody` `{ text }`          | 201 `Answer`                                                                              | 400; 403 `NOT_CLAIM_OWNER`; 410 `CLAIM_EXPIRED`                                      |
| GET    | `/worker/answers`               | worker | `PageQuery`                            | 200 `Page<WorkerQuestionView & { answer: Answer }>` (read-only)                           | 401                                                                                  |

`WorkerQuestionView = { id, status, category, cleanedText, originalText, assistantNotes, preferFemaleWorker, createdAt, claimExpiresAt }`. The woman is anonymous: no name, email, wallet or conversation history.

## 10. Health worker onboarding

| Method | Path                     | Auth             | Request                                                                                                                                            | Response                                                                                                         | Errors                                                          |
| ------ | ------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| GET    | `/worker/profile`        | worker           | none                                                                                                                                               | 200 `WorkerProfile`                                                                                              | 401                                                             |
| PUT    | `/worker/profile`        | worker           | `UpdateWorkerProfileBody` `{ role?, fullNameConfirmed?, gender?, practiceArea?, yearsOfPractice?, licenceNumber?, guidanceNotDiagnosisAccepted? }` | 200 `WorkerProfile` (`regulator` derived: nurse/midwife → `NMCN`, doctor → `MDCN`; `topics` defaulted from role) | 400; 401; 409 if already `approved` and changing licence fields |
| POST   | `/worker/documents`      | worker           | multipart: `type` (`WorkerDocumentType`), `file` (image/PDF, max 10 MB)                                                                            | 201 `WorkerDocument`                                                                                             | 400; 401                                                        |
| DELETE | `/worker/documents/:id`  | worker           | none                                                                                                                                               | 204                                                                                                              | 401; 404; 409 if `pending_review`/`approved`                    |
| POST   | `/worker/profile/submit` | worker           | none                                                                                                                                               | 200 `WorkerProfile` with `verificationStatus: "pending_review"`                                                  | 409 `ONBOARDING_INCOMPLETE` (`details.missing: string[]`)       |
| PATCH  | `/worker/preferences`    | worker           | `UpdateWorkerPreferencesBody` `{ topics?, available? }`                                                                                            | 200 `WorkerProfile`                                                                                              | 400 `TOPICS_REQUIRED` (empty topics)                            |
| PUT    | `/worker/payout-address` | worker + step-up | `UpdatePayoutAddressBody` `{ stellarAddress \| null }`                                                                                             | 200 `WorkerProfile`                                                                                              | 400 `STELLAR_ADDRESS_INVALID`; 403 `STEP_UP_REQUIRED`           |

Required to submit: role, full name confirmed, practice area, years, licence number, all four documents (`practising_licence`, `registration_certificate`, `government_id`, `selfie_with_id`), guidance-not-diagnosis agreement.

## 11. Admin verification

| Method | Path                         | Auth  | Request                                          | Response                                                               | Errors                                |
| ------ | ---------------------------- | ----- | ------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------- |
| GET    | `/admin/workers`             | admin | `?status=pending_review` (default) + `PageQuery` | 200 `Page<AdminWorkerSummary>`                                         | 401; 403                              |
| GET    | `/admin/workers/:id`         | admin | none                                             | 200 `AdminWorkerDetail` (profile + email + short-lived `documentUrls`) | 401; 403; 404                         |
| POST   | `/admin/workers/:id/approve` | admin | none                                             | 200 `AdminWorkerSummary` (`approved`)                                  | 403; 404; 409 if not `pending_review` |
| POST   | `/admin/workers/:id/reject`  | admin | `RejectWorkerBody` `{ reason }`                  | 200 `AdminWorkerSummary` (`rejected`)                                  | 400; 403; 404                         |

Admin checks the licence manually against NMCN / MDCN registers.

## 12. Earnings and withdrawals (health workers)

| Method | Path                  | Auth             | Request                                                                            | Response                                                                                                       | Errors                                                                                                         |
| ------ | --------------------- | ---------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/worker/earnings`    | worker           | none                                                                               | 200 `EarningsResponse` `{ balance, totalEarned, answersCount, recent: EarningEntry[] }`                        | 401                                                                                                            |
| GET    | `/worker/withdrawals` | worker           | `PageQuery`                                                                        | 200 `Page<Withdrawal>`                                                                                         | 401                                                                                                            |
| POST   | `/worker/withdrawals` | worker + step-up | `CreateWithdrawalBody` `{ amountKobo, destination: { kind: "stellar", address } }` | 201 `Withdrawal` `{ id, status, amount, destinationAddress, stellarTxHash, createdAt }` (real testnet payment) | 400 `STELLAR_ADDRESS_INVALID`; 403 `STEP_UP_REQUIRED`; 409 `INSUFFICIENT_BALANCE`; 502 `STELLAR_SUBMIT_FAILED` |

Bank withdrawal: UI shows "coming soon". No endpoint in v0.

## 13. MCP server tools (`apps/mcp`)

Not HTTP endpoints, listed so both sides agree. The MCP server calls the API with a woman's agent token (`POST /auth/agent-tokens`) and is bound by `mcpSpendingLimitPerAnswerKobo` and `mcpAskBeforeEachPayment`.

| Tool                | Calls                                                         | Notes                                                                                                                           |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ask_health_worker` | `POST /questions` (`source: "mcp"`)                           | Requires explicit confirmation of the price in the tool input. Emergency → returns the free emergency response, nothing queued. |
| `get_answer`        | `GET /questions/:id/status`, then `GET /questions/:id/answer` | Pays over x402 from her CareLayer wallet within the Claude limit. Asks first if `mcpAskBeforeEachPayment`.                      |
| `check_balance`     | `GET /wallet`                                                 | Shows naira balance and free answers left.                                                                                      |

## 14. Open questions (resolve before sign-off)

1. **Worker gender.** "Prefer a female health worker" needs it, but onboarding does not collect it. v0 adds optional `gender` to the worker profile. Is the preference a hard filter (only female workers can claim) or a soft signal (shown to workers)?
2. **Do health workers see `originalText`?** v0 says yes (cleaned + original), so nothing is lost in clean-up.
3. **Third-party agent identity.** v0 lets unauthenticated agents create questions and use `X-Question-Key`. Do we want API keys instead?
4. **MCP auth.** v0 uses a revocable agent token. OAuth is the alternative.
5. **Account per app.** Can the same email be both a woman and a health worker? v0 says accounts are per app, so yes, as two accounts.
6. **Answer price.** Fixed (`ANSWER_PRICE_KOBO`, default ₦500) or per category?
7. **NGN/USDC rate.** Fixed config value on testnet (`NGN_PER_USDC`).
