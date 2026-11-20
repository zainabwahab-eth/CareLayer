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
