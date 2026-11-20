# Open questions

Questions that need a decision before work can continue (see `docs/TASKS.md` §1, "When to stop and ask"). Each has options and a recommendation. Answer inline, then move the decision into the decisions log (`docs/TASKS.md` §2) and the contract.

---

## Q1. Z6 chat endpoint: frontend uses the old conversation endpoints, not the agreed `POST /chat`

**Raised by:** Hikmah (H6), November 2026. **For:** Zainab (Z6). **Blocks:** H6 on the real API, H10.

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
