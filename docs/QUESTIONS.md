# Open questions

Questions that need a decision before work can continue (see `docs/TASKS.md` §1, "When to stop and ask"). Each has options and a recommendation. Answer inline, then move the decision into the decisions log (`docs/TASKS.md` §2) and the contract.

---

## Q1. Z6 chat endpoint: frontend uses the old conversation endpoints, not the agreed `POST /chat`

**Raised by:** Hikmah (H6), November 2026. **For:** Zainab (Z6). **Blocks:** H6 on the real API, H10.

> **Answered in Z6 (Zainab): option A, with the draft as its own call.** Contract §7 has the details.
>
> - `POST /chat { messages: ChatTurn[] }` returns the **same shape your ChatProvider already handles**: `{ kind: "reply", message, escalationOffer } | EmergencyResponse`. Only the endpoint and the body change.
> - The draft is **`POST /chat/draft { messages }`** → `{ kind: "draft", draft, draftToken, draftExpiresAt, offer } | EmergencyResponse`. Call it when she taps Send on the offer (W07 shows `draft`) and for "Ask a nurse directly" (her question as the only turn). It is a separate call because building the draft is a second LLM call (about 10 s), and most offers end in "Not now". Each chat reply stays at one call.
> - Send `draftToken` with `POST /questions`, and `originalText` = `draft.originalText`.
> - Limits are in `CHAT_LIMITS`: 40 turns, 4,000 characters each, 12 requests a minute.
> - The old types stay as `@deprecated` until you switch, so nothing breaks.

### Where things stand

|                                       | What it says                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Decisions log (`docs/TASKS.md` §2)    | "Chat history is not stored on the server. Chat lives in the client session."                                                                                                                                                                                                  |
| Z6 task (`docs/TASKS.md` §6)          | Stateless `POST /chat`. History comes from the client. Returns `{ type: "answer" }`, `{ type: "offer", draft: { cleanedText, assistantNotes, category, ageRange?, pregnancyWeeks? }, price, freeAnswersLeft }` or `{ type: "emergency" }`. Nothing stored.                     |
| API contract §7                       | Still lists `POST /chat/conversations`, `GET /chat/conversations`, `GET /chat/conversations/:id`, `POST /chat/conversations/:id/messages`, marked "Superseded… until Z6 lands, treat this section as provisional".                                                             |
| `packages/shared/src/chat.ts`         | `Conversation`, `SendMessageBody { text }`, `SendMessageResponse = { kind: 'reply', message, escalationOffer } \| EmergencyResponse`, `EscalationOffer { price, isFree, freeAnswersRemaining, suggestedCategory, exceedsSpendingLimit }`. No draft.                            |
| `apps/api/src/modules/chat/router.ts` | Skeleton only: **no routes**. `/chat`, `/chat/conversations*` and `/emergency` all return 404 today.                                                                                                                                                                           |
| Web app (H6)                          | `api.chat.createConversation()` then `api.chat.sendMessage(id, { text })`, i.e. the contract §7 endpoints, because those are the only shared types. The thread is kept **in memory in the browser** (never storage), so it can send the full history once `POST /chat` exists. |

### Mismatches to resolve

1. **Endpoint shape.** Conversation resource with server-side messages (contract §7) vs one stateless `POST /chat` with the history in the request (Z6, decisions log).
2. **History format.** Not defined. The client has `{ role: 'user' | 'assistant', text }[]` ready to send. Needs limits: max messages, max characters per message (the web app caps a message at 4,000 characters; the API body limit is 100 kB).
3. **Discriminant.** Z6 note says `type: "answer" | "offer" | "emergency"`. Every existing response union uses `kind` (`EmergencyResponse.kind`, `CreatedQuestion.kind`, `SendMessageResponse.kind`).
4. **Offer fields.** Z6 note: `draft`, `price`, `freeAnswersLeft`. Shared type: `price`, `isFree`, `freeAnswersRemaining`, `suggestedCategory`, `exceedsSpendingLimit`, and **no draft**. The UI shows category, free/paid price and the spending-limit note, so it needs the shared type's fields. W07 Consent needs the draft (cleaned text, notes, category, age range, pregnancy weeks) to show exactly what the nurse receives.
5. **"Ask a nurse directly"** (W06). She can ask for a nurse without the assistant offering one. Neither shape says how she gets a draft in that case.
6. **Emergency.** Both agree the red-flag check runs first and returns `EmergencyResponse` (contract §6). Keep that shape unchanged. The web app depends on `message`, `contacts[].verified` and `findHospitalUrl`.

### Options

**A. Stateless `POST /chat`, `kind` discriminant, `EscalationOffer` + `draft` (recommended).**

```ts
// POST /chat  (auth: woman)
interface ChatRequestBody {
  /** Whole thread so far, oldest first. The last item is her new message (role "user"). */
  messages: { role: 'user' | 'assistant'; text: string }[];
  /** "Ask a nurse directly": always return an offer (still red-flag checked first). */
  askNurse?: boolean;
}

interface QuestionDraft {
  cleanedText: string; // spelling/grammar only, never shortened
  assistantNotes: string | null;
  category: QuestionCategory;
  ageRange: AgeRange | null;
  pregnancyWeeks: number | null;
}

type ChatResponse =
  | { kind: 'answer'; message: ChatMessage }
  | { kind: 'offer'; message: ChatMessage; offer: EscalationOffer & { draft: QuestionDraft } }
  | EmergencyResponse;
```

Matches the decisions log (nothing stored), keeps one discriminant across the API, and reuses the offer fields the UI already renders. `askNurse` answers mismatch 5 without a second endpoint. Errors: 400 `VALIDATION_FAILED` (empty or too long), 401, 429 `RATE_LIMITED`.

**B. Keep the conversation endpoints (contract §7) and store messages.** No frontend change, but contradicts the locked decision "chat history is not stored on the server" and stores sensitive health text.

**C. `POST /chat` exactly as the Z6 note (`type`, `freeAnswersLeft`, no `isFree` / `exceedsSpendingLimit`).** Works, but needs a second discriminant style and drops fields W06 shows (paid price, spending-limit warning). The client would have to work out free vs paid itself.

**Recommendation: A.** Update `docs/API_CONTRACT.md` §7 and `packages/shared/src/chat.ts` in the Z6 PR, and remove the conversation types and endpoints.

### Frontend work once Q1 is decided (Hikmah, after Z6 merges)

> **Done in H10.** `api.chat.send` (`POST /chat`) and `api.chat.draft` (`POST /chat/draft`) replace the conversation methods in both clients. `ChatProvider` sends the in-memory thread. The mock checks drafts and `draftToken` the way the API does. W07 still needs building to call `draft` (Q5a).

- `apps/web/src/api/types.ts`: replace the `chat` group with `send(body: ChatRequestBody): Promise<ChatResponse>`.
- `apps/web/src/api/http/http-api.ts` and `apps/web/src/api/mock/mock-api.ts`: implement it.
- `apps/web/src/chat/ChatProvider.tsx`: send the in-memory thread instead of creating a conversation. Keep the offer's `draft` for W07.
- "Ask a nurse directly": call with `askNurse: true` instead of going straight to W07.

---

## Q2. Emergency contact numbers must be verified before the demo

**Raised by:** Hikmah (H6). **For:** Zainab (Z6) and both before the demo.

`GET /emergency` and every emergency `POST /chat` / `POST /questions` response return `contacts[]` with `verified`. Contract §6: "Emergency numbers must be verified (`verified: true`) before the demo." The mock returns two numbers marked `verified: false` with "(mock data)" in the label.

**What W13 does now:** a number with `verified: false` is never shown as the main red "Call" button. It appears as a secondary button marked "Not verified", with a note to go to the nearest hospital if the call does not connect. If no number is verified, "Find the nearest hospital" becomes the main action.

**Ask:** confirm the real numbers and set `verified: true` only after someone has checked them (who, and when?). Recommendation: keep the `verified` flag in the contract permanently, so a number that has not been checked can never look like a checked one.

> **Z6 status (Zainab):** the API returns one contact, `112` (Nigeria's national emergency number), with `verified: false`, from `EMERGENCY_CONTACTS` in `apps/api/src/modules/emergency/service.ts`. Agreed: the flag stays in the contract permanently. **Still open:** who calls 112 (and any state or hospital line we add) from a Nigerian phone, and when, before the demo. Then flip `verified` in that file.

---

## Q3. Assistant prompt: two Mode B fields to add, and the model offers a nurse too often

**Raised by:** Zainab (Z6), November 2026. **For:** Hikmah (H2). **Blocks:** H2 "done when the test set passes through `/chat`".

### 1. Mode B fields the API now asks for

The API appends short call instructions after `assistant.md` (in `apps/api/src/modules/llm/assistant.ts`, so the prompt file stays yours). For Mode B it asks for two extra fields:

- `statedAge`: her age as a number, only if she stated it. The API turns it into `ageRange` in code.
- `pregnancyWeeks`: only if she stated weeks (never converted from months).

**Ask:** describe these two fields in the prompt's Mode B section, so the prompt and the API agree. Also update the endpoint names it mentions: Mode A is `POST /chat`, Mode B is `POST /chat/draft` and `POST /questions` without a draft.

### 2. Eval result on the real model (`nvidia/nemotron-3-ultra-550b-a55b`)

`npm run eval:assistant -w @carelayer/api` runs your 33-question test set plus a 12-question clean-up set:

| Metric                 | Score                                                    | Threshold |
| ---------------------- | -------------------------------------------------------- | --------- |
| Emergency recall       | **100%** (10/10: 7 by the fixed list, 3 by the LLM only) | 100%      |
| Action accuracy        | **69.7%**                                                | 80%       |
| Category accuracy      | 95.2% (test set), 100% (clean-up set)                    | 80%       |
| Clean-up pass rate     | 100%                                                     | 90%       |
| Age / weeks extraction | 100%                                                     | 90%       |

**Most of the action misses are over-offering.** The model offers a nurse on plain information questions you marked "answer": q01 (tired in early pregnancy), q10 (period pain, Pidgin), q13 (how the injection works), q14 (pill vs coil), q16 (family planning, Pidgin), q18 (UTI symptoms), q23 (foods for women's health).

**Two of your "offer" cases became emergencies** (the LLM's own judgement): q02 (baby moving less at 32 weeks) and q12 (soaking through pads quickly, not pregnant). Both may be right clinically. Worth asking the reviewing nurse or midwife whether the test set or the prompt should change.

(q07 failed on a network blip; the API now retries those once.)

**Options:**

- **A. Tighten the escalation section (recommended).** Add: answer general "what is / how does / is it common" questions directly with no offer; offer only when she describes _her own_ symptoms or situation and needs a judgement on it. A few one-line examples of "answer, no offer" from the test set would help most.
- **B. Leave it.** Over-offering is the safe side, but the app asks her to pay ₦500 more often than needed.

After a prompt change, re-run `npm run eval:assistant -w @carelayer/api`. It takes about 4 minutes, and the report is written to `apps/api/evals/reports/`.
---

## Q3. H7 History, Wallet and Account: API gaps

**Raised by:** Hikmah (H7), November 2026. **For:** Zainab. **Blocks:** H7 on the real API (History and Account), H10.

H7 uses only endpoints in the contract: `GET /me/questions`, `GET /wallet`, `GET /wallet/transactions`, `POST /topups`, `GET /topups/:id`, `GET/PATCH /me`, `GET/PATCH /me/settings`, `GET/PATCH /me/notifications`, `POST /auth/logout`, `POST /auth/logout-all`. Wallet, top-ups, `/me` and logout work against the backend today.

### 3a. Routes in the contract that the backend does not serve yet

| Route                                    | Contract | Backend today | Who builds it?                                         |
| ---------------------------------------- | -------- | ------------- | ------------------------------------------------------ |
| `GET /me/questions`, `/me/questions/:id` | §8.4     | 404           | Z6 (listed in the task)                                |
| `GET/PATCH /me/settings`                 | §3       | 404           | **No Z task lists it.** Z3 built only `GET/PATCH /me`. |
| `GET/PATCH /me/notifications`            | §3       | 404           | **No Z task lists it.**                                |

**What the web app does meanwhile:** each section shows "We could not load these settings" with Try again. Appearance and Quick exit still work, because both are kept on the device. Quick exit says "Saved on this device only" when the save fails.

**Ask:** add `/me/settings` and `/me/notifications` to a Z task (suggest Z6, since `POST /questions` already needs `spendingLimitPerAnswerKobo`).

> **Resolved (checked in H10):** apps/api now serves `GET /me/questions`, `GET /me/questions/:id`, `GET/PATCH /me/settings` and `GET/PATCH /me/notifications`. The request and response shapes match `@carelayer/shared` and what the Account and History screens send. 3b–3f are still open.

### 3b. `MyQuestion` is missing what W12 shows

Figma W12 shows a nurse on "In review" rows and a short title per question.

1. **Nurse while claimed or answered but not opened.** `chosenNurse` is set only for "chosen nurse" questions, and `answer.nurse` only after she opens the answer. For first-available questions the app shows "A nurse is reviewing it" / "Answer ready to open". **Option A (recommended):** add `nurse: PublicNurse | null` to `MyQuestion` (the claiming or answering nurse). PublicNurse has no contact details, so privacy is unchanged. **Option B:** keep the generic text.
2. **Title.** No short title field. The app shows `cleanedText` (her own words, spelling fixed), cut to two lines on mobile and one on desktop. **Recommendation:** keep it that way. A generated title would be a summary, and the decisions log keeps her words unsummarised.
3. **What she actually paid.** `isFree` is "a quote" (§8.1 point 9). History shows "Free" / "₦500" from `isFree` + `price` once `answer` is present, which is wrong if the final charge differed. **Option A (recommended):** add `payment: { amount, paidFromTreasury, stellarTxHash } | null` to `MyQuestion` (same shape as `AnswerResponse.payment`). **Option B:** guarantee in the contract that `isFree` and `price` are final once `answer` is set.
4. **`answeredAt` before she opens it.** Only in `answer.answeredAt`. Needed for "Average time to answer", which today uses opened answers only. Covered by `status` + a top-level `answeredAt` if you prefer.

### 3c. History stats need her whole list

D-W12 shows "Consultations this year", "Spent on answers", "Average time to answer", "Free answer(s) used"; mobile shows "4 consultations this year, ₦1,000 spent". The app works these out from `GET /me/questions?limit=100` and **hides them if `nextCursor` is set** (rather than show a partial count). **Option A:** accept this (few women will pass 100). **Option B:** `GET /me/questions/summary` returning those four numbers. **Recommendation:** A for the hackathon.

Also: the "In review" filter means `open` + `claimed`, but `?status=` takes one value. The app filters on the client. Supporting `?status=open,claimed` would be nice to have, not a blocker.

### 3d. Top-ups

1. **Paystack callback.** `PAYSTACK_CALLBACK_URL` defaults to `http://localhost:5173/account/wallet`. The web wallet route is `/account/wallet`, so this matches. The production value must point at the deployed web app (Z11).
2. **Unfinished top-ups are invisible.** `GET /wallet/transactions` lists confirmed movements only, and there is no `GET /topups`. If she leaves Paystack without coming back, a `pending`/`paid` top-up cannot be shown anywhere. **Option A:** `GET /topups?status=pending,paid`. **Option B:** leave it (it credits anyway and then appears in activity). **Recommendation:** B for now.
3. **Checkout URL check.** The app only follows an `https:` `authorizationUrl` (or same-origin in the mock) and refuses anything else. If Paystack test mode can ever return a non-https URL, tell me.

### 3e. Use CareLayer in Claude (Z12)

The Account screen saves `mcpSpendingLimitPerAnswerKobo` and `mcpAskBeforeEachPayment`, and says "Connecting to Claude is not available yet". Not defined anywhere yet: **how she connects** (connector URL? an agent token from `POST /auth/agent-tokens`, which is in the contract but not built? OAuth?) and **the connection steps** to show. I have not shown a URL or created tokens. Please decide in Z12 and I will add the steps.

### 3f. Appearance: which copy wins?

Contract §3: `appearance` is saved with her settings and also in `localStorage`. The app applies the device copy (before sign-in, no flash) and saves her choice to the account when she changes it. It does **not** apply the account value on another device. Quick exit is the reverse: the account value replaces the device copy when settings load, so every device exits to the same place. **Ask:** confirm that is fine, or say if appearance should follow the account too.

---

## Q4. H9 Health worker application (N01–N04): design and API gaps

**Raised by:** Hikmah (H9), November 2026. **For:** Zainab (contract, Z9) and the designer. **Blocks:** nothing. Every gap below has a working default in the nurse app; these are the decisions to confirm.

**API coverage is complete for the application.** Every call the screens make exists in `apps/api` and matches contract §2 and §10: `POST /auth/code/request`, `POST /auth/code/verify`, `POST /auth/google`, `POST /auth/refresh`, `POST /auth/logout` (all with `app: "nurses"`), `GET`/`PATCH /nurse/profile`, `PATCH /nurse/preferences`, `POST /nurse/documents` (multipart `type` + `file`), `DELETE /nurse/documents/:id` and `POST /nurse/profile/submit`. No new endpoints or fields were needed. The gaps are between the **designs** and what the API requires or can report.

### 4a. Required to submit, but not on any screen

`ONBOARDING_REQUIREMENTS` needs two things the frames never ask for.

| Requirement                    | What the app does now                                                                                                                                       | Decide                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullNameConfirmed`            | A Checkbox under the name on N02: "This is my name exactly as it appears on my licence". Editing the name unticks it.                                       | Designer: approve the wording and placement.                                                                                                                                                                                                                                              |
| `guidanceNotDiagnosisAccepted` | A Checkbox on Step 3: "I'll give guidance, not diagnoses, and tell women to see someone in person when they need to." Sent with `PATCH` just before submit. | **Wording needs sign-off** (ideally by the reviewing nurse or midwife, as for H2). Zainab: the API stores only a timestamp. Should it also store which wording she agreed to, as questions do with `consentTextVersion`? **Recommendation: yes**, so a later wording change is auditable. |

### 4b. Screens with no frame

N02 and N03 say "Step _n_ of 3", but only two steps are drawn. Built from existing components and tokens:

- **Step 3 of 3, "Check and send"** (`/onboarding/submit`): a summary card in N04's checklist style, with "Change" links, the guidance agreement and "Send for review".
- **Sign up with email (mobile), Log in, Verify email:** D-N01's form side, and W04's layout as TASKS §3 says.
- **Rejected state** (on N04's route): the admin's `rejectionReason` and "Fix and send again". The steps reopen, because the API unlocks licence fields and documents once rejected.
- **Approved:** lands on `/today`, which says she's verified. N05 Today is the rest of H9.
- **N04 "Preview how answering works":** the button is drawn but its content isn't. It opens a four-point explainer taken from the decisions log: topic-only alerts, a 10-minute claim, guidance not diagnosis, ₦400 per answer.

**Designer:** please draw Step 3 and the rejected state, or approve these.

### 4c. N04's checklist can't be live

N04 shows four rows ("Details and documents received" Done, "Licence checked with the council" In progress, "Identity matched to your selfie" Waiting, "Ready to answer" Waiting). The API has **one** status for the whole review (`pending_review`). There's no per-check progress, and the admin console approves or rejects in one step.

- **A. Keep the rows fixed while she waits** (what the app does). Honest enough: received is true, and the council check is what the admin is doing.
- **B. Add review sub-steps** (for example `reviewChecks: { licence, identity }` on `NurseProfile`, set from the admin console). Needs a contract and console change.
- **C. Simplify the design** to "Received" → "Being checked" → "Ready".

**Recommendation: A for now, C if the demo shows people expecting the rows to move.** B is only worth it if the review really becomes two separate checks.

### 4d. Fields added to N02

- **Gender (optional).** Not on N02, but `Question.femaleOnly` filters on `NurseProfile.gender = FEMALE`, so a nurse who never sets it never receives "female health workers only" questions. Added as optional chips with the hint "Women can ask for a female health worker. We never show this on your profile."
  - **Zainab:** confirm the hint. `NursePublicProfile` does include `gender`, but the web app's W08 doesn't display it today. If it's shown later, change the hint.
- **"General" topic chip.** The frame has Pregnancy, Periods, Contraception, Sexual health and "All topics". `general` is a fifth category that nurses get by default, but without its own chip it could only be chosen through "All topics", and was then invisible when one chip was turned off. Added a "General" chip; "All topics" still selects all five.

### 4e. Copy to check

- **N03 "Stored encrypted. Never shown to the women you help."** Documents are stored in Postgres (`NurseDocumentFile`). The code doesn't encrypt them itself; Neon encrypts the database at rest. If that's not enough to say "encrypted", change the copy to **"Stored privately. Never shown to the women you help."** **Recommendation:** confirm with Zainab before the demo.
- **N01 mobile has no "Log in" link.** D-N01 has "Already joined? Log in", and returning nurses need a way in, so the app adds it under the buttons.

### 4f. Not collected during the application

`languages`, `bio` and `practiceArea` are optional in the contract and not on N02/N03, so the application doesn't ask for them. W08 shows women a nurse's languages and bio, so they belong on the nurse **Profile** screen (no design yet; rest of H9).

### 4g. Notes for the rest of H9

- **Shared code:** the nurse app imports apps/web's components, auth helpers and `ApiError` through a `@web/*` alias (`apps/workers/vite.config.ts`, `tsconfig.json`). Nothing is copied. Moving them to a `packages/ui` later is a search-and-replace.
- **Google sign-in** is only offered in mock builds, as in apps/web (`apps/web/src/auth/google.ts`), until Google Identity Services is wired up.
- **Mock admin:** in mock builds, N04 shows "Mock API only: act as the admin" (Approve or Reject) so the next states can be tried. It never appears against the real API. The real decision is made in `GET /admin-console`.

---

## Q5. H10 Real API integration: what is connected, and what is still missing

**Raised by:** Hikmah (H10), November 2026. **For:** Zainab (contract, Z11) and Hikmah (remaining screens).

**How this was checked:** every client method was compared with the route, method and zod schema in `apps/api/src/modules/*/router.ts`, and the types in `packages/shared`. `apps/web/src/api/http/http-api.test.ts` pins each path and method. Not checked: a run against a live apps/api with a database, LLM, Paystack and Stellar testnet (none was configured in this session), or a physical phone.

### Connected and matching the backend

| Feature                   | Calls                                                                                                                                        | Notes                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Auth (both apps)          | `POST /auth/code/request`, `/auth/code/verify`, `/auth/google`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`                          | Refresh once on 401 and retry; concurrent refreshes collapse into one; `REFRESH_INVALID`/`REFRESH_REUSED` end the session |
| Chat (W06)                | `POST /chat`                                                                                                                                 | **Changed in H10** from the removed `/chat/conversations*`. The thread is sent each time, last 40 turns                   |
| Draft                     | `POST /chat/draft`                                                                                                                           | In the client and mock; no screen calls it yet (5a)                                                                       |
| History (W12)             | `GET /me/questions`                                                                                                                          | `limit=100`, cursor pages                                                                                                 |
| Wallet                    | `GET /wallet`, `GET /wallet/transactions`                                                                                                    |                                                                                                                           |
| Top-ups                   | `POST /topups`, `GET /topups/:id`                                                                                                            | `amountKobo` within `TOPUP_LIMITS_KOBO`                                                                                   |
| Account                   | `GET/PATCH /me`, `GET/PATCH /me/settings`, `GET/PATCH /me/notifications`                                                                     | PATCH sends only changed fields (the API's schemas are `.strict()`)                                                       |
| Emergency                 | `GET /emergency`                                                                                                                             | Public; the only API response the service worker caches                                                                   |
| Health worker application | `GET/PATCH /nurse/profile`, `PATCH /nurse/preferences`, `POST /nurse/documents`, `DELETE /nurse/documents/:id`, `POST /nurse/profile/submit` | Unchanged from H9 (Q4)                                                                                                    |

Also in H10: a 60 s request timeout, a non-JSON `200` treated as an error (not data), and the mock's `SPENDING_LIMIT_EXCEEDED` details renamed to `spendingLimitKobo` to match the API.

### 5a. Screens not built yet, so their real endpoints are unused (frontend, Hikmah)

W05 Home and W07–W11 (consent, choose who answers, confirm and pay, waiting, nurse response) are still `ScreenPlaceholder`s from H6. The client methods exist and match the API: `chat.draft`, `questions.create` (with `draftToken`), `nurses.list`, `questions.getStatus`, `questions.collectAnswer`, `questions.submitFeedback`. **The end-to-end ask flow cannot run on the real API until these screens exist.** No backend change is needed.

> **Nurse app: done in H11** (Q6).

The same goes for the nurse app after approval (N05–N09 and the profile): the backend serves `GET /nurse/dashboard`, `/nurse/questions`, `/nurse/claim`, claim, release, answer, `/nurse/earnings`, `/nurse/withdrawals`, `PUT /nurse/payout-address` and `POST /auth/step-up`, but `NurseApi` and the screens don't cover them yet.

### 5b. Sessions on phones and in production (Zainab, Z11)

- The refresh cookie is `SameSite=Lax`, `Path=/auth`. It reaches the API only if the app and the API are **same-site**, e.g. `app.example.org` and `api.example.org`. On different sites (two `*.onrender.com` or `*.vercel.app` hosts count as different sites, because those are public suffixes), the session is lost on every reload. `SameSite=None; Secure` does not fix this on iPhone, because Safari blocks third-party cookies.
- **Ask:** deploy the web app, the nurse app and the API under one registrable domain, or serve the API under the app's origin (e.g. a `/api` rewrite on the host). For local phone testing, H10 adds an opt-in Vite proxy that does this (`VITE_API_URL=/api`, see `apps/web/README.md`).
- `PAYSTACK_CALLBACK_URL` and `CORS_ORIGINS` must name the URL the phone actually opens (the tunnel or deployed URL).

### 5c. Small contract points (Zainab)

1. **Timeouts.** The client gives up after 60 s. `POST /chat/draft` is about 10 s, and the API retries the LLM once. Tell me if a slow path can take longer.
2. **A timed-out `POST /me/questions/:id/collect`.** The client reports "taking too long" and she can retry. Please confirm a retry can never charge twice (the decisions log says attempts are reconciled by tx hash).
3. **Google sign-in** is hidden in HTTP builds: Google Identity Services isn't wired in the frontend (`apps/web/src/auth/google.ts`). `POST /auth/google` exists. Confirm the `GOOGLE_CLIENT_ID` for the demo, and I'll add the client.
4. **Use CareLayer in Claude (Q3e).** `POST/GET/DELETE /auth/agent-tokens` now exist. The Account screen still says "not available yet". Confirm that connecting means creating an agent token in the app, and which steps or connector URL to show.

### 5d. Needs a physical device (not done in H10)

Physical-device testing has **not** been done. The checklist is in `apps/web/README.md` ("Testing on phones"): Android Chrome, iPhone Safari and the iPhone home-screen app (which may need its own login once), session persistence, keyboard over the composer, airplane mode and reconnect, Paystack return, Quick exit and Back, install prompts, and camera upload in the nurse app.

---

## Q6. H11 Nurse and midwife workspace (N05–N09, profile, settings): API and design gaps

**Raised by:** Hikmah (H11), November 2026. **For:** Zainab (contract) and the designer. **Blocks:** nothing. Every gap below has a working default in the nurse app.

**What is connected.** Every call is an existing apps/api route. Each one is checked against its router and zod schema, and pinned in `apps/workers/src/api/http-api.test.ts`:

- **Cases:** `GET /nurse/dashboard`, `GET /nurse/questions?tab=`, `GET /nurse/questions/:id`, `GET /nurse/claim`, and `POST /nurse/questions/:id/claim | release | answer`.
- **Money:** `GET /nurse/earnings`, `GET`/`POST /nurse/withdrawals`, `GET /wallet/transactions`.
- **Profile:** `PUT /nurse/payout-address`, `PATCH /nurse/profile`, `PATCH /nurse/preferences`.
- **Account:** `GET`/`PATCH /me/settings` (appearance only), `POST /auth/code/request` (`step_up`, with the bearer token), `POST /auth/step-up`, `GET`/`DELETE /auth/sessions`, `POST /auth/logout-all`.

The workspace is open only to `approved` nurses, matching the API's 403 `NURSE_NOT_APPROVED`. Everyone else keeps the H9 application and N04 screens.

### 6a. No notification feed for nurses (Zainab)

The "Updates" screen (the notification centre) is **worked out from live data**: the dashboard (active claim deadline), the waiting list (chosen for you, new questions in her topics) and earnings (payments, withdrawals). Read/unread is stored **on the device only**, as a list of update ids (never question text), per nurse. So read state does not follow her to another phone, and past events drop off once they leave those lists.

- **A. Keep it derived** (what the app does). No backend work.
- **B. `GET /nurse/notifications` + `POST /nurse/notifications/read`**, written by the same code that sends the alert emails (`modules/questions/alerts.ts`) and by payouts.

**Recommendation:** A for the hackathon, B if nurses use more than one device.

### 6b. Notification preferences (Zainab)

`GET`/`PATCH /me/notifications` is women only. Nurses can only reduce alert emails by changing topics or turning availability off; Settings says so. **Ask:** is a nurse "email me about new questions" switch wanted? It would need a field and a check in `alerts.ts`.

### 6c. No price on a question (Zainab)

`NurseQuestionView` has no amount. N05/N06/N07 show "₦400" as `DEFAULT_ANSWER_PRICE_KOBO × PAYOUT_SPLIT.nurseBps` from `@carelayer/shared`. If `ANSWER_PRICE_KOBO` is changed on the server, the app shows the wrong reward. **Option A (recommended):** add `nurseShare: Money` to `NurseQuestionView`. **Option B:** guarantee the price stays the shared default.

### 6d. N08 "Answer sent" promises an instant payment (designer + Zainab)

The frame says "Paid to your wallet the moment she received it" and shows "Settled 10:50 PM" with "View on Stellar". apps/api pays **when she opens the answer** (`POST /me/questions/:id/collect`), not when it is sent, and `POST /nurse/questions/:id/answer` returns no payment. The app says "You earn ₦400 when she opens it", and the payment shows on Earnings when it lands. **Designer:** please update the N08 copy and table.

### 6e. Completed history has no answer (Zainab)

On the Completed tab, `NurseQuestionView` gives the question but not **her answer**, when she answered, the woman's helpful/not helpful, or whether it was paid. The app lists the question only. **Option A (recommended):** add `myAnswer: { text, answeredAt, recommendSeeSomeoneToday, helpful: boolean | null, paid: boolean } | null` for her own answered questions. **Option B:** leave it; Earnings already shows what was paid.

### 6f. Profile gaps (Zainab + designer)

1. **Profile photo:** no field or upload route. Avatars use initials. Women's W08 has no photo either, so this is fine unless the designer wants one.
2. **Wrong licence details after approval:** licence fields lock (409 `CONFLICT`), and the app says "Contact support". **No support contact is defined.** Please give an email for the app and the API message.
3. **Session names:** `POST /auth/code/verify` accepts `deviceName`, but the H9 sign-in doesn't send it, so Settings lists "Unknown device". A frontend follow-up (a label from the browser, e.g. "Android Chrome"); no backend change.

### 6g. Earnings for nurses who are not approved (Zainab)

`GET /nurse/earnings` and withdrawals work for every status ("earned money stays hers"), but the app shows Earnings only inside the approved workspace. **Ask:** can an approved nurse later be rejected or suspended? If yes, Earnings and Withdraw should also be reachable from N04.

### 6h. Screens without a frame (designer)

These were built from the tokens and the nearest frame, so please draw them or approve:

- **Updates** (the notification centre).
- **Profile** and **Settings**: TASKS §3 "Nurse profile" is split into two screens, so the profile stays short on a phone. The desktop sidebar lists both.
- **Withdraw:** amount, Stellar address, optional memo, "Bank account (coming soon)", then the email code.
- **Payment history:** "All payments" / "Withdrawals".
- **The question before claiming:** N07 without the answer box, plus "Claim and answer" and the claims-close countdown.

**N06:** the Figma chips are "My topics / Pregnancy / Periods". The app shows All, My topics and every category. The filter is client-side because the API lists every eligible question whatever her topics (topics control alerts only).

**N07 checklist:** "Explains when to seek care in person" and "No diagnosis or prescription" must **both be ticked to send**, as a safety gate. The guidance banner wording needs sign-off from the reviewing nurse or midwife (as for H2).

**Desktop:** only the Nurse **mobile** frames were read (TASKS §3: mobile is the source of truth). The desktop sidebar lists every section, with "Health worker workspace" under the logo so it reads as separate from the women's app.
