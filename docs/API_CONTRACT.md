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

**Known follow-ups (not changed in Z1):** the `docs/TASKS.md` screen map uses slightly different names for some routes (`POST /auth/code`, `POST /auth/verify`, `/me/wallet`, `/me/topups`, `POST /chat`, `PATCH /nurse/availability`, `GET /nurse/dashboard`). Each is reconciled in the task that builds it (Z3, Z4, Z5, Z6, Z7, Z9).

## 0. Conventions

| Item        | Rule                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL    | `http://localhost:4000` locally (`VITE_API_URL` in the frontends). No `/v1` prefix.                                                                                                                         |
| Format      | JSON in and out (`Content-Type: application/json`), except document uploads (multipart).                                                                                                                    |
| Auth        | `Authorization: Bearer <accessToken>`. Access tokens last ~15 min. The refresh token lives only in an httpOnly cookie.                                                                                      |
| Auth levels | **public**: no token. **woman** / **nurse** / **admin**: signed in with that role. **any**: any signed-in role. **agent**: signed-in woman, a woman's agent token, or a public agent with `X-Question-Key`. |
| Step-up     | Withdrawals and payout address changes need a code verified in the last 5 minutes (`X-Step-Up-Token` from `POST /auth/step-up`).                                                                            |
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
| 400       | `VALIDATION_FAILED` (`details.issues: { path, message }[]`), `CODE_INVALID`, `STELLAR_ADDRESS_INVALID`, `TOPICS_REQUIRED`, `CONSENT_REQUIRED`                                                                                     |
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

Rules (`AUTH_RULES`): 6-digit code, 10-min expiry, single use, stored hashed, max 5 attempts, resend after 45 s and max 5 per hour. Access token ~15 min. Refresh cookie 90 days (women) / 30 days (nurses), sliding, rotated on every refresh, reuse revokes the session. Accounts are per app: unique on (email, role), so the same email can be a woman and a nurse.

Refresh cookie: `cl_refresh`, `HttpOnly; Secure; SameSite=Lax; Path=/auth`. (Lax, not Strict, so it survives the Google redirect.)

> Z3 reconciles route names with the `docs/TASKS.md` screen map (`POST /auth/code`, `POST /auth/verify`).

| Method | Path                     | Auth   | Request                                                                                                                                                          | Response                                                                                          | Errors                                                                                                              |
| ------ | ------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/code/request`     | public | `RequestCodeBody` `{ email, purpose: "signup"\|"login"\|"step_up", app: "women"\|"nurses", name? }`. `name` required for signup. `step_up` needs a bearer token. | 202 `RequestCodeResponse` `{ sent: true, resendAvailableAt }`                                     | 400 `VALIDATION_FAILED`; 409 `ACCOUNT_EXISTS` (signup); 404 `ACCOUNT_NOT_FOUND` (login); 429 `RATE_LIMITED`         |
| POST   | `/auth/code/verify`      | public | `VerifyCodeBody` `{ email, code, purpose: "signup"\|"login", app, name?, deviceName? }`                                                                          | 200 `AuthTokensResponse` `{ accessToken, accessTokenExpiresAt, user }` + `Set-Cookie: cl_refresh` | 400 `CODE_INVALID` (`details.attemptsRemaining`); 410 `CODE_EXPIRED`; 429 `CODE_ATTEMPTS_EXCEEDED`; 403 `WRONG_APP` |
| POST   | `/auth/google`           | public | `GoogleAuthBody` `{ idToken, mode: "signup"\|"login", app, name?, deviceName? }`                                                                                 | 200 `AuthTokensResponse` + cookie                                                                 | 401 `GOOGLE_TOKEN_INVALID`; 409 `ACCOUNT_EXISTS`; 404 `ACCOUNT_NOT_FOUND`; 403 `WRONG_APP`                          |
| POST   | `/auth/refresh`          | cookie | none                                                                                                                                                             | 200 `AuthTokensResponse` + rotated cookie                                                         | 401 `REFRESH_INVALID`; 401 `REFRESH_REUSED` (session revoked)                                                       |
| POST   | `/auth/logout`           | any    | none                                                                                                                                                             | 204, cookie cleared, current session revoked                                                      | 401                                                                                                                 |
| POST   | `/auth/logout-all`       | any    | none                                                                                                                                                             | 204, every session for this user revoked                                                          | 401                                                                                                                 |
| GET    | `/auth/sessions`         | any    | none                                                                                                                                                             | 200 `SessionInfo[]` `{ id, deviceName, createdAt, lastUsedAt, current }`                          | 401                                                                                                                 |
| DELETE | `/auth/sessions/:id`     | any    | none                                                                                                                                                             | 204                                                                                               | 401; 404                                                                                                            |
| POST   | `/auth/step-up`          | any    | `StepUpBody` `{ code }` (code from `/auth/code/request` with `purpose: "step_up"`)                                                                               | 200 `StepUpResponse` `{ stepUpToken, expiresAt }`                                                 | 400 `CODE_INVALID`; 410 `CODE_EXPIRED`; 429                                                                         |
| POST   | `/auth/agent-tokens`     | woman  | `CreateAgentTokenBody` `{ label }`                                                                                                                               | 201 `CreateAgentTokenResponse` `{ id, label, token, createdAt }` (token shown once)               | 401                                                                                                                 |
| DELETE | `/auth/agent-tokens/:id` | woman  | none                                                                                                                                                             | 204                                                                                               | 401; 404                                                                                                            |

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

Custodial Stellar testnet wallet created at sign-up for every user. Keys never leave the server. Shown in naira. The chain is the source of truth; the server caches the balance after each transaction.

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
