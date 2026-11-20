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
