# CareLayer frontend API audit

**Source of truth:** the published Postman docs, https://documenter.getpostman.com/view/44554019/2sBYPv3YMs (collection "CareLayer API"). **Audited:** 23 November 2026, by Hikmah's session. **Re-checked:** 24 November 2026 on `main` at `ebc1a64`, after H10 (`cbc1395`) and H11 (`3360bab`) merged in PR #28.

> **Current state on `main`:** 0 mismatches. Every route the two apps call is documented or a listed exception, and every documented browser route is called except the three Claude connection routes. The "Before H10/H11" columns below record what `main` looked like when the audit was first run; the "`main` now" column is the current state.

## How this was checked

1. **Docs.** The collection behind the docs page was downloaded from Postman's public documenter API: 53 requests, **50 unique method + path pairs**. It is identical, request by request (method, URL with query string, body), to `docs/postman/carelayer.postman_collection.json`. The contract tests read that repo copy.
2. **Frontend.** Every method of both HTTP clients was called against a stubbed `fetch`, and each method + path was recorded:
   - `apps/web/src/api/http/http-api.ts` (women's app)
   - `apps/workers/src/api/http-api.ts` (nurse app)
3. **Fields.** The documented request bodies, query parameters, headers, auth and example responses were compared with `@carelayer/shared` and the clients.
4. **Branches.** On 23 November, `main` (then `32a0b83`) was audited directly. `feat/hikmah-h11-nurse-workspace`, which contains H10, was audited read-only: its two clients were copied out with `git show` and run through the same check. Branches were not switched, and the H10/H11 fixes were not re-applied on `main` (decided with Hikmah, to avoid duplicate work and merge conflicts).
5. **Re-check after merge.** On 24 November, with H10 and H11 merged (`ebc1a64`), both clients on `main` were run through the same route check. The result is identical to what the H11 branch showed on 23 November: 39 documented routes called, 7 called-but-undocumented (all in the exception list), 3 not yet called, 0 mismatches. The field-level notes were not re-derived; they were made on the H11 branch code, which is what merged.
6. **Not done:** a run against a live apps/api. Paths, bodies and types match the docs; responses were not observed from a running server.

**Guard:**

- `apps/web/src/api/http/contract.test.ts` fails if the women's app calls a route that is neither documented nor a listed exception.
- `apps/workers/src/api/contract.test.ts` does the same for the nurse app. It also fails if a documented route is neither called, marked "not for a browser", nor listed as not built yet (`NOT_YET_CALLED`, now only the three `/auth/agent-tokens` routes).
- The exception lists are in `apps/web/src/test/route-exceptions.ts`; the shared helpers (collection reader, stubbed-fetch route recorder) are in `apps/web/src/test/postman-contract.ts`. The nurse app imports both through the `@web/*` alias.

## Summary

|                                                | Before H10/H11 (`32a0b83`)         | `main` now (`ebc1a64`) |
| ---------------------------------------------- | ---------------------------------- | ---------------------- |
| Documented endpoints (method + path)           | 50                                 | 50                     |
| Called by the frontends and documented         | 26                                 | 39                     |
| Mismatches                                     | **4** (women's chat; fixed by H10) | **0**                  |
| Called but not in the docs (exist in apps/api) | 4                                  | 7                      |
| Documented, browser use intended, not called   | 16                                 | 3 (Claude connections) |
| Documented, not for a browser                  | 8                                  | 8                      |

**Field level:** request bodies, query parameters, headers, auth and response fields match wherever a route is called. See the notes at the end.

## Endpoint compliance matrix

The "Actual" and "Status" columns are `main` before H10/H11 merged. The last column is `main` now (H10 and H11 merged), which is what the H11 branch was audited as.

Statuses:

- **MATCH:** the frontend calls the route exactly as documented.
- **MISMATCH — UNRESOLVED:** the frontend calls a route the docs and API don't have (none left on `main`).
- **NOT DOCUMENTED:** the frontend calls a route that apps/api serves but Postman lacks.
- **NOT IMPLEMENTED:** documented, but no browser code calls it.

### Women's app

| Feature       | Documented                                                                                    | Actual (before H10/H11)                                                           | Status (before)             | `main` now                         |
| ------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------- | ---------------------------------- |
| Auth          | `POST /auth/code/request` `{ email, purpose, app }` (+ `name` on sign-up)                     | same                                                                              | MATCH                       | MATCH                              |
| Auth          | `POST /auth/code/verify` `{ email, code, purpose, app, deviceName? }`                         | same (`deviceName` not sent; optional)                                            | MATCH                       | MATCH                              |
| Auth          | `POST /auth/refresh` (refresh cookie, no bearer)                                              | same, `credentials: 'include'`                                                    | MATCH                       | MATCH                              |
| Auth          | `POST /auth/logout` (bearer)                                                                  | same                                                                              | MATCH                       | MATCH                              |
| Auth          | —                                                                                             | `POST /auth/google`                                                               | NOT DOCUMENTED (served)     | same                               |
| Auth          | —                                                                                             | `POST /auth/logout-all`                                                           | NOT DOCUMENTED (served)     | same                               |
| Account       | `GET /me`                                                                                     | same                                                                              | MATCH                       | MATCH                              |
| Account       | —                                                                                             | `PATCH /me` `{ displayName }`                                                     | NOT DOCUMENTED (served)     | same                               |
| Settings      | `GET /me/settings`                                                                            | same                                                                              | MATCH                       | MATCH                              |
| Settings      | `PATCH /me/settings` `{ appearance, quickExitTarget, spendingLimitPerAnswerKobo }`            | same (one changed field per request)                                              | MATCH                       | MATCH                              |
| Notifications | `GET /me/notifications`                                                                       | same                                                                              | MATCH                       | MATCH                              |
| Notifications | `PATCH /me/notifications` `{ notifyWhenAnswered }`                                            | same                                                                              | MATCH                       | MATCH                              |
| Chat          | `POST /chat` `{ messages }`                                                                   | `POST /chat/conversations`                                                        | **MISMATCH — UNRESOLVED**   | **MATCH** (H10, cbc1395)           |
| Chat          | — (route does not exist)                                                                      | `POST /chat/conversations/:id/messages` `{ text }`                                | **MISMATCH — UNRESOLVED**   | removed                            |
| Chat          | — (route does not exist)                                                                      | `GET /chat/conversations`, `GET /chat/conversations/:id` (client only, no screen) | **MISMATCH — UNRESOLVED**   | removed                            |
| Chat          | `POST /chat/draft` `{ messages }`                                                             | not called                                                                        | NOT IMPLEMENTED             | MATCH (client; no screen yet, W07) |
| Emergency     | `GET /emergency` (no auth)                                                                    | same, no token                                                                    | MATCH                       | MATCH                              |
| Questions     | `GET /nurses?topic=&femaleOnly=`                                                              | same                                                                              | MATCH                       | MATCH                              |
| Questions     | `POST /questions` `{ originalText, source, consent, nurseSelection, femaleOnly, draftToken }` | client matches; no screen yet (W07–W09)                                           | MATCH                       | MATCH                              |
| Questions     | `GET /questions/:id/status`                                                                   | client matches; no screen yet (W10)                                               | MATCH                       | MATCH                              |
| History       | `GET /me/questions?status=&limit=`                                                            | same (+ `cursor`)                                                                 | MATCH                       | MATCH                              |
| History       | `GET /me/questions/:id`                                                                       | same                                                                              | MATCH                       | MATCH                              |
| Answers       | `POST /me/questions/:id/collect` `{ approvedAboveLimit?, confirmPayment? }`                   | same (no body = defaults)                                                         | MATCH                       | MATCH                              |
| Answers       | `POST /questions/:id/feedback` `{ helpful }`                                                  | same                                                                              | MATCH                       | MATCH                              |
| Answers       | `GET /questions/:id/answer` (x402, `PAYMENT-SIGNATURE`)                                       | not called: for outside agents; the app uses collect                              | NOT IMPLEMENTED (by design) | same                               |
| Wallet        | `GET /wallet`                                                                                 | same                                                                              | MATCH                       | MATCH                              |
| Wallet        | `GET /wallet/transactions?limit=`                                                             | same (+ `cursor`)                                                                 | MATCH                       | MATCH                              |
| Top-up        | `POST /topups` `{ amountKobo }`                                                               | same                                                                              | MATCH                       | MATCH                              |
| Top-up        | `GET /topups/:id`                                                                             | same                                                                              | MATCH                       | MATCH                              |
| Claude        | `POST /auth/agent-tokens` `{ label }`                                                         | not called ("Use CareLayer in Claude" says not available yet)                     | NOT IMPLEMENTED             | NOT IMPLEMENTED                    |
| Claude        | `GET /auth/agent-tokens`                                                                      | not called                                                                        | NOT IMPLEMENTED             | NOT IMPLEMENTED                    |
| Claude        | `DELETE /auth/agent-tokens/:id`                                                               | not called                                                                        | NOT IMPLEMENTED             | NOT IMPLEMENTED                    |

### Nurse app

| Feature       | Documented                                                                        | Actual (before H10/H11)                                                            | Status (before)         | `main` now                                               |
| ------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------- |
| Auth          | `POST /auth/code/request` (app `nurses`)                                          | same                                                                               | MATCH                   | MATCH (+ `step_up` with bearer)                          |
| Auth          | `POST /auth/code/verify`                                                          | same                                                                               | MATCH                   | MATCH                                                    |
| Auth          | `POST /auth/refresh`                                                              | same                                                                               | MATCH                   | MATCH                                                    |
| Auth          | `POST /auth/logout`                                                               | same                                                                               | MATCH                   | MATCH                                                    |
| Auth          | —                                                                                 | `POST /auth/google`                                                                | NOT DOCUMENTED (served) | same                                                     |
| Auth          | —                                                                                 | —                                                                                  | —                       | `POST /auth/logout-all`: NOT DOCUMENTED (served)         |
| Auth          | —                                                                                 | —                                                                                  | —                       | `POST /auth/step-up` `{ code }`: NOT DOCUMENTED (served) |
| Sessions      | `GET /auth/sessions`                                                              | not called                                                                         | NOT IMPLEMENTED         | MATCH                                                    |
| Sessions      | —                                                                                 | —                                                                                  | —                       | `DELETE /auth/sessions/:id`: NOT DOCUMENTED (served)     |
| Application   | `GET /nurse/profile`                                                              | same                                                                               | MATCH                   | MATCH                                                    |
| Application   | `PATCH /nurse/profile`                                                            | same (also sends `fullName`, which the API accepts; the doc example leaves it out) | MATCH                   | MATCH                                                    |
| Application   | `POST /nurse/documents` (multipart `type`, then `file`)                           | same; no JSON Content-Type                                                         | MATCH                   | MATCH                                                    |
| Application   | —                                                                                 | `DELETE /nurse/documents/:id`                                                      | NOT DOCUMENTED (served) | same                                                     |
| Application   | `POST /nurse/profile/submit`                                                      | same                                                                               | MATCH                   | MATCH                                                    |
| Preferences   | `PATCH /nurse/preferences` `{ topics, available }`                                | same                                                                               | MATCH                   | MATCH                                                    |
| Settings      | `GET /me/settings`, `PATCH /me/settings` (appearance only for nurses)             | not called                                                                         | NOT IMPLEMENTED         | MATCH                                                    |
| Dashboard     | `GET /nurse/dashboard`                                                            | not called                                                                         | NOT IMPLEMENTED         | MATCH                                                    |
| Cases         | `GET /nurse/questions?tab=waiting` / `?tab=completed&limit=`                      | not called                                                                         | NOT IMPLEMENTED         | MATCH (+ `cursor`)                                       |
| Cases         | —                                                                                 | —                                                                                  | —                       | `GET /nurse/questions/:id`: NOT DOCUMENTED (served)      |
| Cases         | `GET /nurse/claim`                                                                | not called                                                                         | NOT IMPLEMENTED         | MATCH                                                    |
| Claiming      | `POST /nurse/questions/:id/claim`                                                 | not called                                                                         | NOT IMPLEMENTED         | MATCH                                                    |
| Claiming      | `POST /nurse/questions/:id/release`                                               | not called                                                                         | NOT IMPLEMENTED         | MATCH                                                    |
| Answering     | `POST /nurse/questions/:id/answer` `{ text, recommendSeeSomeoneToday }`           | not called                                                                         | NOT IMPLEMENTED         | MATCH                                                    |
| Earnings      | `GET /nurse/earnings`                                                             | not called                                                                         | NOT IMPLEMENTED         | MATCH                                                    |
| Earnings      | `GET /wallet/transactions`                                                        | not called                                                                         | NOT IMPLEMENTED         | MATCH                                                    |
| Withdrawals   | `GET /nurse/withdrawals?limit=`                                                   | not called                                                                         | NOT IMPLEMENTED         | MATCH (+ `cursor`)                                       |
| Withdrawals   | `POST /nurse/withdrawals` `{ amountKobo, destination: { kind, address, memo? } }` | not called                                                                         | NOT IMPLEMENTED         | MATCH                                                    |
| Payout wallet | `PUT /nurse/payout-address` `{ stellarAddress }`                                  | not called                                                                         | NOT IMPLEMENTED         | MATCH                                                    |

### Not for a browser (documented, no frontend use intended)

| Documented                                                                                                                                  | Used by                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /health`                                                                                                                               | uptime checks, deploy                                                 |
| `GET /x402-test?ready=`                                                                                                                     | Z2 x402 proof, development only                                       |
| `POST /webhooks/paystack` (`x-paystack-signature`)                                                                                          | Paystack → API                                                        |
| `GET /admin/nurses?status=&limit=`, `GET /admin/nurses/:id`, `POST /admin/nurses/:id/approve`, `POST /admin/nurses/:id/reject` `{ reason }` | the API's own admin console (`GET /admin-console`)                    |
| `GET /questions/:id/answer`                                                                                                                 | outside AI agents paying by x402 (listed under the women's app above) |

## Field-level notes

- **Auth and tokens:**
  - The access token is held in memory and sent as `Authorization: Bearer`. Documented routes use bearer auth; `GET /emergency` is `noauth`, and the client sends no token there.
  - The refresh token is only the httpOnly cookie (Postman: "Refresh (rotates cookie)"). Every request uses `credentials: 'include'`.
  - On `401 UNAUTHENTICATED` the client refreshes once, then retries. Concurrent refreshes share one request.
- **Content types:**
  - JSON bodies send `Content-Type: application/json`, as documented.
  - The document upload sends `FormData`, fields `type` then `file`, and lets the browser set the multipart boundary.
- **Errors:** the documented error shape `{ error: { code, message, details? } }` becomes `ApiError(status, code, message, details)`. These detail fields match the documented examples:
  - `details.missing` (submit)
  - `details.field` (withdrawals)
  - `details.available` and `requested` (insufficient balance)
  - `details.priceKobo` and `spendingLimitKobo` (collect)
  - `details.stepUpTtlMinutes` (step-up required)
  - `details.questionId` on `409 ACTIVE_CLAIM_EXISTS` is in `docs/API_CONTRACT.md` §9; Postman's only claim-conflict example is `QUESTION_ALREADY_CLAIMED`.
- **Responses:** every documented example matches the `@carelayer/shared` type the frontend reads. That covers `AuthTokensResponse`, `User`, `ChatResponse`, `DraftResponse`, `EmergencyResponse`, `NursePublicProfile`, `CreatedQuestion`, `QuestionStatusResponse`, `AnswerResponse`, `FeedbackResponse`, `UserSettings`, `NotificationPreferences`, `NurseProfile`, `NurseDocument`, `EarningsResponse`, `Withdrawal`, `Page<…>`, `NurseDashboard`, `NurseQuestionView`, `Claim` and `Answer`.
- **Stale doc examples (not a frontend issue):** the "Withdrawal confirmed" and "Withdrawals page" examples leave out `destinationMemo`. apps/api always returns it, as `null` when there is no memo (`modules/nurses/earnings.ts`, `memoOf`), which matches the shared type.
- **Mock mode:** before H10, the women's mock copied the wrong chat endpoints (conversations); H10 (merged) made it stateless like `POST /chat`. The nurse mock follows the documented rules (H9's application plus H11's workspace, both on `main`).
