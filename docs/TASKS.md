# CareLayer task guide

This file is the working plan for Claude Code. Read it together with `CLAUDE.md`, `docs/PROJECT_BRIEF.md` and `docs/API_CONTRACT.md` at the start of every session.

- **Zainab:** backend, payments, AI integration, MCP (tasks Z1–Z12)
- **Hikmah:** design tokens, frontend, AI behaviour (tasks H1–H10)

Nothing here is fixed: change the order if something works better, but record the change in the decisions log (section 2).

### Who owns what

Each person runs their own Claude Code sessions and works only on their own tasks.

- **Zainab's sessions:** only Z tasks. Edit `apps/api`, `apps/mcp`, `packages/shared`, `docs/` and Postman. Never edit `apps/web`, `apps/workers`, `packages/tokens`, `apps/api/prompts/` or `apps/api/config/red-flags.json` (Hikmah owns those). If an H task needs a backend change, do it as part of the matching Z task.
- **Hikmah's sessions:** only H tasks. Edit `apps/web`, `apps/workers`, `packages/tokens`, `apps/api/prompts/`, `apps/api/config/red-flags.json`. Never edit backend code; if the API needs to change, write it to `docs/QUESTIONS.md` for Zainab.
- Shared files (`packages/shared`, `docs/API_CONTRACT.md`): changed only by Zainab, in backend PRs. Hikmah reviews those PRs.

To start a session, tell Claude Code who you are: "I'm Zainab. Read CLAUDE.md and docs/TASKS.md, then continue the next unticked Z task."

---

## 1. How to work (every task)

Claude Code should follow this loop without waiting for new prompts:

1. **Start:** pull `main`, create a branch named after the task (`z3-auth`, `h6-chat-flow`).
2. **Read:** this file's section for the task, the decisions log, and the relevant API contract sections.
3. **Plan:** write a short plan in the session (files to touch, endpoints, tests). Go ahead unless the plan needs a decision that isn't in this file (see "When to stop and ask").
4. **Build:** small commits on the branch.
5. **Test:** write the tests listed for the task and make them pass. Run lint and typecheck.
6. **Postman (backend tasks):** add or update requests in the Postman collection **"CareLayer API"** (folder per module), with an example response for each request. Export it to `docs/postman/carelayer.postman_collection.json` and the environment to `docs/postman/carelayer.local.postman_environment.json` (no secrets in the export).
7. **Docs:** update `docs/API_CONTRACT.md` and `packages/shared` if any endpoint or type changed. Tick the task in the status tracker (section 8).
   **Env:** if an env var was added, renamed or removed, update `.env.example` (a gate test fails if `config.ts` reads a key it lacks), run `npm run env:sync -w @carelayer/api`, and list in the session and the PR every key that still needs a value from the user (secrets and account-tied keys).
8. **PR:** open a pull request into `main` with: what changed, how to test it, any contract changes (in bold), and screenshots for frontend work. The other person approves. Squash and merge.

### When to stop and ask

Stop and write the question to `docs/QUESTIONS.md` (with options and a recommendation), then tell the user, only when:

- a product decision isn't covered by this file, the brief or the designs;
- something would change the API contract in a way that affects the other person's work;
- a third-party service (x402, Stellar, Paystack, MCP) behaves differently from what this plan assumes.

For everything else, make a sensible choice, note it in the PR description, and keep going.

### Testing tools

- **API:** Vitest + Supertest against a test database (`DATABASE_URL_TEST`). Stellar and Paystack calls go through small service wrappers so tests can mock them; one integration test per payment task runs against testnet when `RUN_TESTNET=1`.
- **Frontend:** Vitest + Testing Library for components and flows, against the mock API.
- Every PR: `npm run lint`, `npm run typecheck`, `npm test` all pass.

---

## 2. Decisions log (locked)

These override anything older in other docs. If you change one, update this list in the same PR.

**Product**

- Health workers are **registered nurses and midwives only**. No doctors, no MDCN.
- Women ask the AI assistant in their own words. AI answers are free.
- Women never choose a category. The AI assigns one: Pregnancy, Periods, Contraception, Sexual health, General.
- The question sent to a nurse is the woman's own words with spelling and grammar fixed, **never shortened or summarised**. Store `originalText` and `cleanedText`. Assistant notes are stored separately.
- Shared with the nurse, with consent: cleaned question, assistant notes, category, age range (`UNDER_18 | AGE_18_24 | AGE_25_34 | AGE_35_44 | AGE_45_PLUS`), pregnancy weeks if relevant. Never her name, email, phone or location. Consent is recorded per question (fields shared, consent text version, time).
- **Nurse selection:** "First available" (default) or a specific nurse. A chosen nurse has 10 minutes to claim; after that, or if she releases or her claim expires, the question opens to everyone.
- **"Only female health workers"** toggle on the selection screen: `Question.femaleOnly` filters by `NurseProfile.gender = FEMALE`.
- **Claims:** one active claim per nurse, 10-minute lock with countdown, Release button.
- **Expiry:** no new claims after 30 minutes. An active claim may finish its 10-minute lock (max wait 40 minutes). Unanswered question → expired, she pays nothing. UI wording: "If no nurse picks it up within 30 minutes, you pay nothing."
- **Price:** ₦500 per answer (`ANSWER_PRICE_KOBO=50000`). Nurse gets 80% (₦400), platform 20%.
- **Free answers:** first 3 per woman. The nurse is still paid ₦400 from the treasury.
- **Pay on delivery:** nothing is charged until the answer is ready.
- **Feedback:** helpful / not helpful on each answer. Nurse rating shown as **% helpful + count**, e.g. "96% helpful (212)". No stars.
- Nurses can tick **"Recommend she sees someone today"** on an answer.
- Nurse profile: full name as on licence, role (nurse or midwife), gender (optional), years of practice, short bio (280 chars), languages (fixed list: English, Pidgin, Yoruba, Hausa, Igbo), topics, available toggle, average response time, % helpful.
- **Emergencies:** fixed red-flag list + LLM check on every message. Triggered → free emergency screen, nothing queued. Logged as `EmergencyEvent` with source + timestamp only (no user id, no text, no red-flag id).
- **Notifications:** "Notify me when answered" by email only.
- **Chat history:** not stored on the server. Chat lives in the client session. Only questions sent to nurses are stored.

**Accounts and auth**

- Passwordless: Google sign-in, or email + 6-digit code. Separate Sign up and Log in screens.
- Women sign up with "What should we call you?" + email. Nurses with "Full name, as on your licence" + email.
- Accounts are per app: unique on (email, role).
- Code: 6 digits, 10-minute expiry, single use, hashed, max 5 attempts, resend after 45 s and max 5 per hour.
- Sessions: 15-minute access token; refresh token in an httpOnly, Secure, SameSite cookie; rotated on every use; reuse revokes the session (after a 10 s grace window for concurrent refreshes from two tabs, decided in Z3). Women 90 days sliding, nurses 30 days. Logout and logout-all. Fresh code (last 5 minutes) required for withdrawals and payout address changes.
- Roles: `WOMAN`, `NURSE`, `ADMIN`. Routes: `/me/*` (women), `/nurse/*`, `/admin/*`. (Renamed from `worker`; tell Hikmah in the Z1 PR.)

**Money and chain**

- Naira as integer kobo (`Int`), USDC as integer stroops (`BigInt`, 7 decimals). No floats.
- The chain is the source of truth for balances; `Wallet.cachedBalanceStroops` is refreshed after each transaction.
- Fixed demo exchange rate from `NGN_PER_USDC`.
- Every user gets a custodial Stellar testnet wallet at sign-up; secrets encrypted with `WALLET_ENCRYPTION_KEY`; the treasury sponsors reserves and adds the USDC trustline.
- Top-up: Paystack test mode → test USDC from the treasury.
- Women: **no withdrawals** for now. Nurses: withdraw to a Stellar address; bank withdrawal shown as "Coming soon". Optional destination memo (text or ID) for exchanges; the treasury pays the fee (fee bump). Decided in Z10.
- Store the Stellar transaction hash on every payment, payout, top-up and withdrawal.

**x402 (decided in Z2, November 2026)**

- **Packages:** the official `@x402/core`, `@x402/express`, `@x402/stellar`, `@x402/fetch`, pinned at 2.31.0, with `@stellar/stellar-sdk` 16 (the version `@x402/stellar` depends on).
- **Facilitator: OpenZeppelin Channels, hosted** (`https://channels.openzeppelin.com/x402/testnet`, anonymous testnet key from `/testnet/gen`). Why: it is the facilitator the Stellar docs point to for `stellar:testnet`, it sponsors fees (the payer only spends USDC), and there is nothing to host. The Coinbase facilitator does not list Stellar. Self-hosting the OpenZeppelin Relayer plugin is the fallback if the hosted service is down or rate-limited; the code only depends on the `FacilitatorClient` interface, so switching is a URL and key change.
- **Price and receiving address can be set per request.** `price` and `payTo` both accept a function of the request context (path, headers, query). Z8 prices each answer and can direct `payTo` per question. Proven in `test/payments.x402.test.ts`.
- **Pay-on-delivery guard is our own Express middleware**, mounted before `paymentMiddleware`. x402's built-in `onProtectedRequest` hook can only deny with a 403, and the contract needs 409 `QUESTION_NOT_ANSWERED`.
- **Prices are explicit USDC stroop amounts** (`{ asset: USDC SAC, amount: "100000" }`), never `"$0.01"` strings.
- **Payers are classic accounts with a USDC trustline.** The client signs a Soroban auth entry with `createEd25519Signer(secret)`, so custodial wallets need no smart account. Test USDC comes from the testnet DEX (XLM → USDC path payment), not a faucet.
- **For Z8:** a facilitator `settle()` timeout is indeterminate (the payment may still have gone through). Record the attempt before settling and reconcile by tx hash, so a retry never charges twice.

**Privacy and safety UI**

- Quick exit on every women's screen: `window.location.replace()` to Google (or weather/news from settings). Back must not return. Doesn't log out. Next open shows a blank new chat. Esc twice on desktop.
- Appearance: System (default) / Light / Dark.

**Out of scope:** real licence verification APIs, mainnet, real naira on/off-ramp, bank withdrawals, women's withdrawals, passwords, native apps, push notifications, weekly availability hours.

---

## 3. Designs

Figma file: **"CareLayer – Product design v1"**, key `cCmDYngHpc03VO66FsVUvD`.

- Pages: `Design system`, `Women -mobile`, `Nurse -mobile`, `Women — Desktop`, `Nurse — Desktop`. Each app page has a dark mode section below the light screens.
- **Mobile pages are the source of truth.** Desktop and dark versions use the same components and data.
- Figma calls are limited. Read each screen once with `get_design_context` when you build it, never re-read a screen you've already built, and use the tokens (section 4) for everything else. Never read the dark mode sections; dark mode comes from the tokens.
- The designs say "Lafiya" nowhere; the product is CareLayer.

### Screen map

| Frame                            | Route                                              | App     | Data / endpoints                                                        |
| -------------------------------- | -------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| W01 Welcome                      | `/`                                                | web     | none                                                                    |
| W02 Before you start             | `/start`                                           | web     | none (agreement stored on sign-up)                                      |
| W03 Sign up                      | `/signup`                                          | web     | `POST /auth/code/request`, `POST /auth/google`                          |
| W04 Verify email                 | `/verify`                                          | web     | `POST /auth/code/verify`                                                |
| _(no design)_ Log in             | `/login`                                           | web     | `POST /auth/code/request`                                               |
| W05 Home                         | `/home`                                            | web     | `GET /me`, `GET /wallet`, `GET /me/questions?status=active`             |
| W06 Assistant chat               | `/ask`                                             | web     | `POST /chat`                                                            |
| W07 Consent                      | `/ask/send/consent`                                | web     | `POST /chat/draft`                                                      |
| W08 Choose who answers           | `/ask/send/nurse`                                  | web     | `GET /nurses?topic=`                                                    |
| W09 Confirm and pay              | `/ask/send/confirm`                                | web     | `POST /questions`                                                       |
| W10 Waiting                      | `/questions/:id` (status open/claimed)             | web     | `GET /questions/:id/status`                                             |
| W11 Nurse response               | `/questions/:id` (answered)                        | web     | `GET /questions/:id/answer`, `POST /questions/:id/feedback`             |
| W12 History                      | `/history`                                         | web     | `GET /me/questions`                                                     |
| W13 Emergency                    | `/emergency`                                       | web     | returned by `POST /chat`                                                |
| _(no design)_ Wallet             | `/account/wallet`                                  | web     | `GET /wallet`, `POST /topups`                                           |
| _(no design)_ Account / settings | `/account`                                         | web     | `GET/PATCH /me/settings`, `POST /auth/logout`, `POST /auth/logout-all`  |
| N01 Join                         | `/` (workers app)                                  | workers | `POST /auth/code/request`, `POST /auth/google`                          |
| _(no design)_ Log in + verify    | `/login`, `/verify`                                | workers | `POST /auth/code/request`, `POST /auth/code/verify`                     |
| N02 Verify licence               | `/onboarding/licence`                              | workers | `PATCH /nurse/profile`                                                  |
| N03 Documents                    | `/onboarding/documents`                            | workers | `POST /nurse/documents`, `POST /nurse/profile/submit`                   |
| N04 Under review                 | `/onboarding/review`                               | workers | `GET /nurse/profile`                                                    |
| N05 Today                        | `/today`                                           | workers | `GET /nurse/dashboard`, `PATCH /nurse/preferences`                      |
| N06 Cases                        | `/cases`                                           | workers | `GET /nurse/questions?tab=waiting                                       | active  | completed`, `POST /nurse/questions/:id/claim` |
| N07 Respond                      | `/cases/:id`                                       | workers | `POST /nurse/questions/:id/release`, `POST /nurse/questions/:id/answer` |
| N08 Answer sent                  | `/cases/:id/sent`                                  | workers | response of the answer call                                             |
| N09 Earnings                     | `/earnings`                                        | workers | `GET /nurse/earnings`, `POST /nurse/withdrawals`                        |
| _(no design)_ Profile / settings | `/profile`                                         | workers | `GET/PATCH /nurse/profile`, topics, appearance, logout                  |
| _(no design)_ Admin review       | `/admin` (in api, server-rendered or minimal page) | api     | `GET /admin/nurses?status=pending`, `POST /admin/nurses/:id/approve     | reject` |

### Screens without a design

Build these from the tokens and existing components; match the nearest designed screen.

- **Women log in:** same layout as W03 without the name field. Title "Welcome back", button "Send me a code", footer "New here? Create an account".
- **Nurse log in:** same as N01's form side. Title "Welcome back", footer "New here? Join as a nurse or midwife". Verify screen reuses W04's layout.
- **Women wallet:** balance card like the nurse earnings card (balance in naira, "Held as USDC in your own wallet"), Top up button only, free answers left, spending limit per answer, activity list with "View on Stellar" links. Top up opens a sheet (mobile) or modal (desktop): amounts ₦1,000 / ₦2,000 / ₦5,000 / Other, then Paystack.
- **Women account:** name and email; Appearance (System/Light/Dark); Quick exit opens (Google/Weather/News, with "Try it now"); spending limit per answer; notify me when answered; Use CareLayer in Claude (connection steps, connector URL, separate Claude limit, ask before each payment); Add to Home Screen; Log out; Log out of all devices.
- **Nurse profile:** profile card with verified badge; bio, languages, years; Topics I answer (checkbox list, at least one; alerts only for chosen topics); payout wallet (change requires fresh code); Appearance; Log out; Log out of all devices.
- **Admin:** a plain table of pending nurses with documents (signed short-lived links), Approve / Reject with reason. Admin-only.

---

## 4. Design tokens (for H1)

From the Figma variables "CareLayer colour" (Light / Dark). Name CSS variables by role, exactly as below.

| Token            | Light   | Dark    | Use                                                 |
| ---------------- | ------- | ------- | --------------------------------------------------- |
| canvas           | #F3F5F2 | #131917 | App background                                      |
| surface          | #FFFFFF | #1B2320 | Cards, sheets, inputs                               |
| surface-soft     | #EAF0EC | #222C28 | Quiet panels, assistant bubbles                     |
| ink              | #13201D | #EBF0ED | Primary text                                        |
| ink-muted        | #55635F | #A3B0AB | Secondary text                                      |
| line             | #D9E1DC | #2E3935 | Borders, dividers                                   |
| primary          | #0F4A43 | #1F6B60 | Main actions, brand surfaces                        |
| primary-soft     | #DCEBE6 | #1B332E | Selected states, highlights                         |
| primary-text     | #0F4A43 | #7CC7B8 | Brand-coloured text, links, icons, selected borders |
| on-primary       | #FFFFFF | #FFFFFF | Text on primary                                     |
| on-primary-muted | #DCEBE6 | #CFE6DF | Secondary text on primary panels                    |
| accent           | #D9932E | #E0A040 | Warmth, progress, quick exit                        |
| accent-soft      | #FAEBD3 | #3A2E1B | Tips, gentle notes                                  |
| on-accent        | #13201D | #1F1606 | Text/icons on accent                                |
| rose             | #C2766A | #C9847A | Avatars, people                                     |
| rose-soft        | #F6E3DE | #3A2825 | Her chat messages                                   |
| verified         | #1D6FA8 | #7DB8E8 | Verified professionals only                         |
| verified-soft    | #E1EEF7 | #172A3A | Verified badge background                           |
| emergency        | #B42318 | #F2938A | Emergencies only                                    |
| emergency-soft   | #FDECEA | #3B1F1C | Emergency background                                |
| on-emergency     | #FFFFFF | #2A0E0B | Text on emergency buttons                           |
| chart-bar        | #DCEBE6 | #2F5F56 | Inactive chart bars                                 |

- **Fonts:** Literata Medium (headings), Hanken Grotesk Regular/Medium/SemiBold (everything else).
- **Type scale (size/line height):** Display XL 56/62 (desktop only), Display L 40/46, Display M 30/36, Display S 24/30 (Literata); Title L 20/28 SemiBold, Title M 17/24 SemiBold, Body L 17/26, Body M 15/22, Body S 13/18, Label M 15/20 SemiBold, Label S 13/16 SemiBold, Caption 12/16 Medium.
- **Spacing:** 4, 8, 12, 16, 20, 24, 32, 40. Mobile side margin 20px; desktop main padding 48px.
- **Radius:** 10 / 14 (buttons, inputs) / 20 (cards) / 28 / full (badges, chips).
- **Rules:** blue = verified only, red = emergency only. Touch targets ≥ 48px.
- **Responsive:** under 1024px use the mobile layouts (content max 640px on tablets); from 1024px the tab bar becomes the 264px left sidebar shown in the desktop frames.

---

## 5. Shared setup (both, first)

1. Agree `docs/API_CONTRACT.md` v1 after Z1 lands (Hikmah reviews the Z1 PR).
2. Keys in local `.env` files only: Stellar testnet treasury, Paystack test keys, LLM API key, Google OAuth client ID, email sending key.
3. Hikmah's frontend uses mock handlers (Mock Service Worker) generated from `packages/shared` types; each endpoint switches from mock to real when its backend task merges.
4. Daily 15-minute check-in: done, next, blocked. Mention any change to `packages/shared` or the contract.

---

## 6. Zainab: backend, payments, AI integration, MCP

Order: Z1 → Z2 → Z3 → Z4 → Z5 → Z6 → Z9 → Z7 → Z8 → Z10 → Z11 → Z12.

### Z1. Database schema and API skeleton (done, PR #6)

The schema draft is approved with the decisions in section 2. Build it.

- Prisma schema covering: users, sessions, refresh tokens, email codes, agent tokens, user settings, notification preferences, wallets, nurse profiles, nurse documents, topics, nurse topics, questions (incl. `femaleOnly`, `ageRange`, `pregnancyWeeks`, selection/chosen nurse window, `expiresAt`), consents (`SharedField` includes `AGE_RANGE`, `PREGNANCY_WEEKS`), claims (partial unique indexes: one active claim per nurse and per question), answers (`recommendSeeSomeoneToday`), feedback, payments, payouts, top-ups, withdrawals, emergency events.
- Rename `worker` → `nurse` everywhere (DB, shared types, contract routes). List renamed routes and types in the PR description for Hikmah.
- Seed: one woman "Tolu" (1 free answer used, balance ₦0: top up for real to get money), nurses Amaka Okafor (midwife, 9 yrs, English/Igbo), Funmilayo Bello (midwife, 6 yrs, English/Yoruba), Hauwa Musa (nurse-midwife → role MIDWIFE, 11 yrs, English/Hausa), all approved and female; one pending nurse; one admin; questions in every status.
- Skeleton: module folders (auth, users, wallets, chat, questions, nurses, payments, admin), zod env validation, central error handler, request logging, `GET /health` returning `{ status, database }` and 503 when the DB is down.
- Fix README and brief (no doctors). Update the contract with: expired/cancelled statuses, `nurseSelection` + `chosenNurseId` + `femaleOnly` on create question, `recommendSeeSomeoneToday`, `GET /nurses`, feedback, notification preferences.

**Tests:** migrate fresh DB + seed succeeds; `/health` 200 and 503 (DB down); partial unique indexes reject a second active claim.
**Postman:** Health request; collection and environment created.
**Done when:** merged, and Hikmah's mocks use the shared types.

### Z2. Prove an x402 payment on Stellar testnet (done: [paid tx](https://stellar.expert/explorer/testnet/tx/b2ce568136e4372c5b5faa5ab963ebeac8ad94afaa661bb2ccbf2f6b09ef30ed))

- Read the current x402 Stellar docs first. Choose the facilitator (Coinbase x402 facilitator or the OpenZeppelin relayer x402 plugin) and record why in the decisions log.
- Test route `GET /x402-test` priced 0.01 USDC to the treasury; script `scripts/pay-x402.ts` pays it as a client with a test wallet and prints the tx hash.
- Prove the pay-on-delivery guard: a check before the payment middleware returns 409 and requests no payment when a condition is false.
- Find out whether price and receiving address can be set per request; write the answer in the decisions log (affects Z8).

**Tests:** testnet integration test (`RUN_TESTNET=1`) for a successful payment; unit test that the guard returns 409 without a 402.
**Done when:** a payment link on the Stellar testnet explorer is in the PR.

### Z3. Passwordless auth and sessions (done)

Implement everything in "Accounts and auth" (section 2): `POST /auth/code/request` (purpose signup/login/step_up, app), `POST /auth/code/verify`, `POST /auth/google`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /me`; role middleware; email sending behind a wrapper (log to console in dev).

**Tests:** expiry, 5-attempt lock, resend limits, refresh rotation, reuse detection revokes the session, logout-all, role guard (woman can't call `/nurse/*`), per-app accounts (same email as woman and nurse).
**Postman:** Auth folder; a pre-request script or environment variable flow that stores the access token.
**Done when:** Hikmah's auth screens work against the real API.

### Z4. Wallet for every user (done)

- On sign-up, create a keypair, encrypt the secret, have the treasury sponsor the account and add the USDC trustline.
- `GET /wallet` (any role; nurses' earnings view comes in Z10): USDC balance, naira equivalent, free answers left (women).
- **Decided in Z4:**
  - **Wallet first, chain after.** The wallet row is created in the same write as the user, so every account has an address. Activation on Stellar happens right after sign-up and never blocks it. It is retried in the background with backoff, and on `GET /wallet`. `WalletResponse.status` is `pending` until the account is on-chain.
  - **One activation transaction:** sponsored reserves + 0-XLM account + USDC trustline. The treasury pays every reserve and the fee.
  - **Seeded wallets** are real keypairs that start pending; the API activates them when it runs with a treasury. Every seeded balance is ₦0 and there are no seeded top-ups (removed in Z5): money only comes from real test top-ups, so balance and history always match the chain.
  - **Z8 note:** payments from a custodial wallet need its secret: `decryptWalletSecret()` in `src/modules/wallets/crypto.ts`. The account holds 0 XLM, which is fine for x402 (the facilitator pays fees). Withdrawals (Z10) need a fee-bump from the treasury.

**Tests:** wallet service unit tests with Stellar mocked; testnet integration test creates an account with a trustline.
**Done when:** every new user has a working testnet wallet visible on the explorer.

### Z5. Top-up with Paystack test mode (backend done; "done when" needs H7's wallet screen)

- `POST /topups` initialises a Paystack test transaction; webhook verifies the signature, then sends test USDC from the treasury; idempotent on the Paystack reference; records the Stellar hash.
- **Decided in Z5:**
  - **Payment is confirmed by the signed webhook OR a server-side verify** (`GET /topups/:id` + a background loop every minute). Webhooks cannot reach localhost, so local dev works without a tunnel, and a missed webhook never strands a payment.
  - **The paid amount and currency must match** the top-up.
  - **New status `paid`** between `pending` and `credited` (Paystack confirmed, USDC on its way).
  - **No double credit:** the credit is claimed with a conditional update, and the treasury's Stellar payment carries memo = top-up id. Before any retry, Horizon is searched for that memo.
  - **A pending wallet is activated before crediting.**
  - **Unpaid top-ups are closed as `abandoned` after 24 h**, but a late payment is still honoured.
  - **Limits:** ₦100 to ₦100,000 per top-up. Test keys only (`sk_test_`); live keys are refused by config.
  - **Paystack receives her account email** (it sends the receipt). Revisit if we want to pass a relay address instead.

**Tests:** signature check; duplicate webhook credits once; failed payment credits nothing.
**Postman:** Top-up folder, including a sample webhook body.
**Done when:** a test-card top-up updates the balance from the real wallet screen.

### Z6. Chat, emergencies and sending questions (done)

- **Decided in Z6:**
  - **LLM: NVIDIA's free hosted tier, behind an OpenAI-compatible client.** Zainab has no Anthropic key and limited OpenAI credit. Switching provider is `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` (OpenAI works unchanged). The global "route LLM calls through local Claude Code" rule does not fit a deployed product (no Claude Code on the server, personal subscription, one process per message), so Zainab chose a hosted API.
  - **Model `nvidia/nemotron-3-ultra-550b-a55b`**, measured on the real prompt (November 2026): 9 to 12 s per call, valid JSON on every call. Kimi K3.1, Mistral Large 4, GLM 5.3, Gemma 4 and Step 5 timed out at 90 s on the free tier; MiniMax M3.1 took 12 to 23 s and cut off one reply.
  - **Q1 answered: chat is `POST /chat { messages }`** (the client sends the thread; the response keeps the existing `{ kind: "reply", message, escalationOffer }` shape, so the web app's handling stays). **The draft is a separate `POST /chat/draft`**, not part of the offer. Building it is a second LLM call (about 10 s), and most offers end in "Not now", so it only runs when she opens W07 or uses "Ask a nurse directly". Each chat reply stays at one call.
  - **Signed draft (`draftToken`).** `POST /questions` stores exactly the draft she reviewed on W07, with no second LLM run that could word it differently, and nothing is stored between the two calls. It is an HS256 JWT on a key derived from `JWT_ACCESS_SECRET`, bound to her id, valid 2 hours. Calls without a token (agents) get a fresh Mode B run.
  - **The question for a nurse = all her messages in the thread, joined verbatim.** Never a model-chosen subset: nothing she said can be dropped.
  - **Deterministic guards on the model's output:**
    - The clean-up may not shorten her text below 70%, more than double it, or drop any number she wrote. One retry; then her own words are used as `cleanedText`.
    - The age range is computed in code from a stated age that appears in her text.
    - Pregnancy weeks are kept only if she wrote weeks.
    - A red-flag suspicion always beats an offer.
  - **Red flags:** her new chat message, and the whole question for drafts and `POST /questions`. The fixed list runs before the LLM and works when the LLM is down. `red-flags.json` is validated at startup (a broken file stops the API).
  - **Emergency contacts: `112` marked `verified: false`** until a person checks it (Q2). `findHospitalUrl` is a map search on her device.
  - **Free answers left = 3 − collected − free questions still in flight.** Used in offers, questions and `GET /wallet`. An expired question gives its free answer back. The seed follows the same rule: Tolu has 1 used + 2 held by open questions = 0 left. Demo the free path with a new account.
  - **Consent must share `cleaned_text` + `category`.** Fields she does not share are not stored.
  - **Nurse alerts** email the topic only (never the question), to approved + available nurses with that topic (female only if asked), or only the chosen nurse. The other nurses get alerted when the window passes (Z7 sweeper).
  - **Rate limit:** 12 chat/draft requests per woman per minute, in memory (one API instance). It protects the free tier's ~40 requests a minute.
  - **Woman-only for now:** `GET /nurses` and the question endpoints. Agent tokens and `X-Question-Key` come with Z12.
  - **Evals:** `npm run eval:assistant -w @carelayer/api` runs Hikmah's test set and the clean-up set (`apps/api/evals/cleanup-cases.json`) on the real model. Thresholds: emergency recall 100%; action, category, clean-up and extraction ≥ 80–90%. Run before each demo and whenever the prompt or model changes.
- `POST /chat`: red-flag check first (fixed list in `apps/api/config/red-flags.json` + LLM); emergency → `{ type: "emergency" }`, log `EmergencyEvent`, nothing queued. Otherwise call the LLM with `apps/api/prompts/assistant.md` (Hikmah owns it) and return `{ type: "answer" }` or `{ type: "offer", draft: { cleanedText, assistantNotes, category, ageRange?, pregnancyWeeks? }, price, freeAnswersLeft }`. Chat history comes from the client in the request; nothing is stored.
- `GET /nurses?topic=&femaleOnly=`: available, approved nurses with public profile fields only.
- `POST /questions`: requires consent fields; stores original + cleaned text, notes, category, age range, pregnancy weeks, selection, chosen nurse window (10 min), `expiresAt` (30 min), price, free flag; checks her spending limit. Alerts nurses for the topic (email, behind a wrapper).
- `GET /questions/:id/status`, `GET /me/questions`.
- Use a placeholder prompt until H2 lands.

**Tests:** emergency creates no question; consent required; cleaned text stored separately from original; spending limit enforced; chosen-nurse visibility rule.
**Postman:** Chat and Questions folders.

### Z9. Nurse onboarding and admin approval (done)

- **Decided in Z9:**
  - **Documents are stored in Postgres** (`NurseDocumentFile`, chosen by Zainab). No new account or key. Private by design: there is no file URL. Files survive redeploys and are backed up with the database. The database grows about 2–10 MB per nurse; Neon's free 0.5 GB holds roughly 50–200 nurses. To move to a bucket later, change only `src/modules/nurses/documents.ts`.
  - **File type is detected from the bytes** (PDF, JPEG, PNG, WebP, HEIC for iPhone photos), never from the name or the browser's claim. Max 10 MB. Files are served back with `nosniff` and a sandboxing CSP.
  - **Signed document links:** HMAC, 10 minutes, bound to the admin who opened the nurse (every view is logged with the admin's id). The path `/files/nurse-documents/:id` sits outside `/admin` because a link opened in a new tab or an `<img>` carries no bearer token.
  - **Licence fields and documents are locked while `pending_review` as well as once `approved`.** The admin's decision is about exactly what she submitted.
  - **`fullName` is editable until submit** (her name exactly as on the licence) and also becomes her display name.
  - **Decisions are conditional updates on `pending_review`:** two admins at once means one wins and the other gets 409. Rejecting also sets her unavailable. She is emailed either way.
  - **`/nurse/questions*` and `/nurse/claim` are guarded for approved nurses now**, so Z7's routes are protected from the start.
  - **Admin page `GET /admin-console`:** plain HTML + JS from the API, signing in with an emailed code (`app: "admin"`), behind a nonce CSP. Nurse-supplied text is only ever inserted as text. The seeded admin is `admin@example.com`.
  - **Seed:** seeded nurses' documents now have placeholder PDF files, so the admin page opens real files after `db:seed`.
  - **Screen map:** `PATCH /nurse/availability` is `PATCH /nurse/preferences { available }` (the contract name).
- `GET/PATCH /nurse/profile`, `POST /nurse/documents` (private storage, never public URLs), `POST /nurse/profile/submit`, topics with role defaults (midwives: Pregnancy + Periods; nurses: all), `PATCH /nurse/preferences` (topics, available).
- Admin: `GET /admin/nurses?status=`, `POST /admin/nurses/:id/approve`, `POST /admin/nurses/:id/reject`, signed short-lived document links, and a minimal admin page.

**Tests:** unapproved nurse can't see questions; at least one topic required; documents not publicly reachable.
**Postman:** Nurse profile and Admin folders.

### Z7. Claiming and answering (done)

- **Decided in Z7:**
  - **Waiting = every eligible open question, not filtered by topic.** The decisions log, brief and contract all say topics control alerts only. This task line originally said "by topic"; corrected.
  - **Claims are atomic in two layers:**
    1. A conditional update (`OPEN` and claims open → `CLAIMED`).
    2. The partial unique indexes (one `ACTIVE` claim per nurse and per question).

    Tested with two nurses claiming at once, and one nurse claiming two questions at once.

  - **Time rules are applied on every request and by the sweeper** (every 30 s, `index.ts`). A late tick is never wrong: an expired lock frees her at once, and a passed chosen window shows the question to everyone at once.
  - **Release or lock expiry after claims close (30 min)** → the question becomes `expired` (she pays nothing), not reopened.
  - **A chosen nurse letting go** (release, or her lock expiring) opens the question to everyone at once. The others are emailed, as they are when the 10-minute window passes. The chosen nurse is not emailed again.
  - **"Answer is ready" email to the woman** (if `notifyWhenAnswered`), with a deliberately vague subject ("You have a new message on CareLayer") and no answer text: someone else may see her inbox. New env var `WEB_APP_URL` for the link.
  - **`GET /nurse/dashboard`** (N05 Today) works for any verification status; waiting counts are 0 until approved. Days and weeks are Lagos time (UTC+1, weeks from Monday).
  - **Waiting is not paged** (open questions are all under 30 minutes old). Completed is cursor-paged.
- `GET /nurse/questions?tab=waiting|active|completed` (waiting = every eligible open question by selection window and `femaleOnly`; topics are for alerts only), `POST /nurse/questions/:id/claim` (atomic; one active claim; no claims after 30 min), `POST /nurse/questions/:id/release`, `POST /nurse/questions/:id/answer` (with `recommendSeeSomeoneToday`), `GET /nurse/dashboard`.
- Background sweeper (every 30 s): expire claims → reopen; open chosen-nurse questions after 10 min; expire questions after 30 min with no active claim.

**Tests:** two simultaneous claims → exactly one wins; second active claim refused; release reopens; claim after 30 min refused; sweeper transitions.
**Postman:** Nurse cases folder.

### Z8. Pay on delivery and nurse payouts (done: [her x402 payment](https://stellar.expert/explorer/testnet/tx/99c94f8827856f0400fa5df2a45dfe7ae861a1605887f5e4b05b6b8606803f31), [nurse 80% payout](https://stellar.expert/explorer/testnet/tx/547d121517089f589d0f02c36bd6ef4dab770d830810fed3d0cafa0f708c83be))

- **Decided in Z8:**
  - **Manual x402 flow, not `paymentMiddleware`.** Checked in `@x402/express` 2.31.0: the middleware runs the handler before it settles. It does buffer the body and drop it when settlement fails, but the handler would have to mark the answer paid before settlement is known, a repeated fetch would be charged again, and an indeterminate settle could not be recorded first. The route now does verify → record the attempt → settle → read and return the answer, with the official `@x402/core` server (requirements, headers, verify, settle). The wire format is the same.
  - **Indeterminate settles are reconciled on chain.** A Stellar x402 payment is a SAC `transfer`, and its hash is only known after settlement. So a pending attempt is matched on Horizon by payer → platform, USDC, exact amount, after the attempt started (her custodial wallet only pays through our agent, one question at a time). Not found once the signed payment has expired (120 s + 60 s margin) → failed, and she can pay again. Meanwhile it is a 503 `paymentPending`, never a second 402.
  - **Facilitator errors:**
    - A 429 or 4xx on settle → failed attempt, 503 retryable.
    - A 5xx, timeout or network error on settle → pending, reconciled.
    - A verify error (nothing moves on verify) → 503, nothing recorded.
  - **The internal agent runs in process.** `POST /me/questions/:id/collect` signs with her decrypted custodial secret (`createEd25519Signer`) and calls the same service function as `GET /questions/:id/answer`, not a loopback HTTP request. The payment is still a real x402 payload verified and settled by the facilitator.
  - **Free is decided on collection:** quoted free and still under 3 used (a conditional update, so two collects cannot both take the last one). A paid quote stays paid.
  - **Payouts are separate from her answer.** The payout row is written in the same transaction that confirms her payment. Sending it is retried by a background loop every minute with backoff, and never delays her answer. Each payout is claimed with a conditional update, and its Stellar memo is the payout id, searched before any resend, as with top-ups. It goes to the nurse's own address if set, else her custodial wallet (activated first if pending).
  - **`payTo` defaults to the treasury's public key** when `X402_PAY_TO_ADDRESS` is empty. The facilitator client is now built whenever `X402_FACILITATOR_API_KEY` is set; without it, paid answers answer 503 and free answers still work. No new env vars.
  - **Spending limit at collect:** price above her limit → 409 unless `approvedAboveLimit` (new optional collect body). Balance is read live from Horizon (cached value if Stellar is slow).
  - **End to end:** `npm run answer:e2e -w @carelayer/api` (and the `RUN_TESTNET` test) runs one paid flow on testnet and prints both explorer links.

- `GET /questions/:id/answer` is x402-protected; the guard before the middleware returns 409 (no payment requested) unless the question is answered.
- An internal agent service acts as the x402 client with the woman's custodial wallet, after checking her spending limit and free answers. Free answers skip her payment.
- After settlement, pay the nurse 80% from the treasury (also for free answers); record both hashes; idempotent (never charge or pay twice).
- `POST /questions/:id/feedback` updates the nurse's % helpful cache.
- **Hard requirement: the answer is never returned unless settlement succeeds.** Z2 found that x402's Express `paymentMiddleware` runs the route handler before it settles. Check whether it withholds the handler's body when settlement fails. If it can return the body before or without a successful settle, do not use `paymentMiddleware` for this route: use a manual flow instead (verify the payment → settle with the facilitator → only then load and return the answer).
- **Facilitator resilience (from Z2):** the facilitator URL and key are env vars (`X402_FACILITATOR_URL`, `X402_FACILITATOR_API_KEY`). Map facilitator 429 and 5xx (and timeouts) to a clear error (`503`, retryable, nothing charged or recorded as paid). A `settle()` timeout is indeterminate: record the attempt first and reconcile by tx hash before any retry.

**Tests:** unanswered → 409 and no charge; paid answer creates payment + payout; free answer charges nothing and pays the nurse; repeated fetch doesn't charge again; **a test that forces settlement to fail and asserts no answer text is returned and nothing is recorded as paid**; facilitator 429/5xx returns the clear error; testnet integration test end to end.
**Done when:** one full question flow shows both transactions on the explorer.

### Z10. Earnings and withdrawals (done: [real withdrawal with a memo, fee paid by the treasury](https://stellar.expert/explorer/testnet/tx/04f8bfa8959bc0476747b1a9be13aaed2ce79309f279e8ee07c737b8817f23e4))

- **Decided in Z10:**
  - **Withdrawals are fee-bumped.** Her custodial account holds 0 XLM (Z4), so the USDC payment is signed by her custodial key and wrapped in a fee-bump transaction signed and paid by the treasury. No XLM is ever sent to nurses.
  - **The destination is checked first.** It must exist and trust testnet USDC, otherwise the payment could never land. It may not be her own CareLayer wallet.
  - **One withdrawal in flight per nurse**, enforced by a partial unique index (`Withdrawal_one_in_flight_per_nurse`). Without it, two withdrawals at once could both pass the balance check. `available` = chain balance minus in-flight withdrawals.
  - **Outcomes:**
    - Stellar refuses (result codes) → `FAILED`, 502 `STELLAR_SUBMIT_FAILED`, nothing moved.
    - No answer (timeout) → stays `SUBMITTED` and returns 201 `submitted`. The transaction is built and signed first, and its hash (final before submitting) is stored as `preparedTxHash`. A loop every minute (and her next read) looks that exact hash up on Horizon: success → `CONFIRMED`; failed on chain → `FAILED`. Not found once the transaction's 60 s window is over (+2 min margin) → `FAILED`. Never sent twice.
    - A `PENDING` row never claimed for sending (crash) → `FAILED` after 2 minutes.
  - **Minimum ₦100**, Stellar only. Bank is "Coming soon".
  - **Optional destination memo** (`destination.memo: { type: "text" | "id", value }`), because exchanges credit deposits by memo and a deposit without it can be lost. It follows Stellar's rules: text up to 28 bytes, id = an unsigned 64-bit number. The type is explicit (most exchanges use memo IDs; a number sent as text may not be credited). This is why recovery uses the stored transaction hash, not a memo: the memo is hers.
  - **Any nurse can see earnings and withdraw**, whatever her verification status: earned money stays hers (e.g. after a rejection).
  - **`EarningsResponse` reshaped for N09:** `available`, a Mon–Sun chart (Lagos days, weeks from Monday), this week, this month, all time, and `recent` mixing earnings and withdrawals. An earning's `title` is the start of the question she answered (40 characters, cut on a word). She already saw the full question in her Completed tab.
  - **End to end:** `npm run withdrawal:e2e -w @carelayer/api` runs the Z8 flow, then withdraws ₦100 to the test payer wallet and prints the links.
- **Follow-up (not done):** `PUT /nurse/payout-address` accepts any valid address. A payout to an address without a USDC trustline would retry forever. It should get the same destination check.

- `GET /nurse/earnings` (balance, this week, this month, daily totals for the chart, payments list with explorer links), `POST /nurse/withdrawals` (fresh code required; Stellar address only).

**Tests:** withdrawal without fresh code refused; insufficient balance refused; success records the hash.

### Z11. Deploy

- **Decided in Z11:**
  - **Google Cloud Run + Neon (free), chosen by Zainab.** Region `europe-west2` (London), next to the Neon database (`eu-west-2`); Neon has no African region. The database URL is Neon's direct host (no `-pooler`), because Prisma migrations need a direct connection.
  - **One instance that never sleeps:** `--min-instances 1 --max-instances 1 --no-cpu-throttling`. The background loops (claim expiry, payouts, top-ups, withdrawals) and the in-memory chat rate limit live in the process. Scaling to zero would stop the loops; a second instance would double them.
  - **Image:** repo-root `Dockerfile` (API + `packages/shared` only), built by Cloud Build, so no local Docker is needed.
  - **The same image runs the migrations** (Cloud Run job `prisma migrate deploy`, before every deploy) and the one-time seed (Cloud Run job).
  - **Secrets** live in Google Secret Manager, uploaded from a gitignored `apps/api/deploy/.env.production` by `deploy/cloudrun.sh secrets`. Values are never printed. Plain settings are env vars on the service.
  - **A separate testnet treasury and facilitator key for the deployed API** (`CARELAYER_ENV_FILE=deploy/.env.production npm run testnet:setup`), not the local one.
  - **Production seed:** the seed wipes every table, so in production it needs `CARELAYER_SEED_PRODUCTION=wipe-and-seed`, and it refuses once any real account (not `@example.com`) exists. The admin's email comes from `SEED_ADMIN_EMAIL`, because `/admin-console` codes are emailed.
  - **Cookies across domains:** the frontends and the API are on different domains, so `AUTH_COOKIE_SAMESITE=none` + `Secure`.
  - **Logs** carry a Cloud Logging `severity`.
  - **Production LLM: OpenAI `gpt-4.1`** (Zainab's paid key), not NVIDIA's free tier. NVIDIA took 9–12 s per reply and is limited to about 40 requests a minute shared by everyone. No code change: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. Chosen by `npm run eval:assistant` (November 2026):

    | Model          | Result   | Emergency recall | Action | Category | Invalid replies | Latency   |
    | -------------- | -------- | ---------------- | ------ | -------- | --------------- | --------- |
    | `gpt-4o-mini`  | pass     | 100%             | 87.9%  | 91.3%    | 2 / 33          | 1.7–4.4 s |
    | `gpt-4.1-mini` | **fail** | 100%             | 69.7%  | 100%     | 0               |           |
    | `gpt-4.1`      | pass     | 100%             | 81.8%  | 100%     | 0               | 1.7–1.8 s |
    - `gpt-4.1` has no invalid replies and 100% categories.
    - Its misses are safe-side: it offers a nurse where a direct answer was expected (the known over-offering, H2), and q02 (32 weeks, baby moving less) goes to emergency, which midwives would also say.
    - `gpt-4o-mini` is about 13x cheaper, but 1 question in about 16 gets a "try again" error.
    - Cost is about 3,170 tokens in and 180 out per call, roughly $0.008 at list price, less with OpenAI's automatic prompt caching.
    - The key's account should have a spending limit.
    - Newer models (`gpt-5.x`, `gpt-6.x`, o-series) reject `max_tokens`, so they would need the client to send `max_completion_tokens` (and no `temperature`).

  - **Privacy:** OpenAI does not train on API data by default but keeps requests up to 30 days for abuse monitoring. Questions contain no name, email or phone (decisions log), but the woman's own words are sent.
  - Runbook: `apps/api/README.md` → "Deploy". Postman environment: "CareLayer Cloud Run".
  - **Deployed (22 November 2026):** https://carelayer-api-598920525559.europe-west2.run.app (project `carelayer`, `europe-west2`). Migrations applied and the demo data seeded; the admin is Zainab's email. Email is sent from Zainab's verified domain `info.zapescrow.xyz` until CareLayer has its own domain. Then update `EMAIL_FROM` + `EMAIL_API_KEY`, run `secrets` and `deploy`.
  - **Open:** Hikmah's frontend URLs (`CORS_ORIGINS`, `WEB_APP_URL`, `NURSE_APP_URL`, `PAYSTACK_CALLBACK_URL`; then `deploy`), and the phone test ("Done when").
- **For Hikmah (deploying the frontends):**
  - **API URL:** `apps/api/deploy/cloudrun.sh url` (Zainab shares it). The frontends call it directly, with `credentials: 'include'` so the refresh cookie (`SameSite=None; Secure`) is sent.
  - **Send Zainab both final frontend URLs.** They go in `CORS_ORIGINS`, `WEB_APP_URL`, `NURSE_APP_URL` and `PAYSTACK_CALLBACK_URL` (`<web>/account/wallet`). Until then the browser blocks calls (CORS).
  - **Google sign-in:** the Google OAuth client needs both frontend origins as authorised JavaScript origins.
- Deploy API + Postgres (Cloud Run or similar), set env vars, run migrations and seed, share the URL. Add a Postman environment for the deployed API.
- **Before the demo:** the hosted OpenZeppelin facilitator key is anonymous with undocumented rate limits. Checked in Z11: the GitHub-login keys (`channels.openzeppelin.com/gen`) are for the **mainnet** facilitator only; testnet keys are always anonymous (`/testnet/gen`). So for the testnet demo, keep a spare testnet key ready, or stand up the self-hosted OpenZeppelin Relayer x402 plugin as a fallback. Switching is only `X402_FACILITATOR_URL` + `X402_FACILITATOR_API_KEY`.

**Done when:** both frontends work against the deployed API on a phone.

### Z12. MCP server for Claude

- `apps/mcp` with the official TypeScript MCP SDK. Tools: `ask_health_worker` (returns the price and requires explicit confirmation before sending), `get_answer`, `get_balance`. Authenticates with an agent token linked to her account; separate Claude spending limit and "ask before each payment"; emergencies return the same free guidance.
- Document how to add it to Claude as a custom connector.

**Done when:** a question from Claude and one from the web app go to the same nurse queue and are both paid via x402 (the two-agent demo).

---

## 7. Hikmah: tokens, frontend, AI behaviour

Order: H1 → H2 → H3 → H4 → H5 → H6 → H7 → H8 → H9 → H10. All screens are built against mocks first.

### H1. Design tokens

- `packages/tokens/tokens.css` from section 4: light on `:root`, dark on `[data-theme="dark"]` and under `prefers-color-scheme: dark` when no theme is set. Load the fonts. A `/tokens` preview page in `apps/web`.
- **Done when:** no raw colour values in either app.

### H2. Assistant behaviour

- `apps/api/prompts/assistant.md`: tone, what it answers itself, when to offer a nurse, never diagnose, the clean-up-not-summarise rule, category rules, assistant notes format, extracting age range and pregnancy weeks only when she mentioned them.
- `apps/api/config/red-flags.json`: red-flag symptoms.
- `apps/api/prompts/test-set.json`: ~30 questions with expected outcome (answer / offer / emergency) and category. Get a nurse or midwife to review the red flags.
- **Done when:** the test set passes through Zainab's `/chat`.
- **Open after Z6 (read `docs/QUESTIONS.md` Q3 first).** The eval runs the test set (`apps/api/test/fixtures/assistant-test-questions.json`) through the real model: `npm run eval:assistant -w @carelayer/api` (about 4 min; needs `LLM_API_KEY` in `apps/api/.env`, a free NVIDIA key from build.nvidia.com works).
  - **Baseline:** emergency recall 100%, category 95%, clean-up 100%, but **action accuracy 69.7% (target 80%)**.
  - **The main problem is over-offering.** The model offers a nurse on plain information questions marked "answer": q01, q10, q13, q14, q16, q18, q23.
  - **Fix in `assistant.md`'s escalation section:**
    - Answer general "what is / how does / is it common" questions directly, with no offer.
    - Offer a nurse only when she describes her _own_ symptoms or situation and needs a judgement on it.
    - Add a few one-line "answer, no offer" examples.
  - **Also in `assistant.md`:**
    - Describe the two Mode B fields the API now asks for: `statedAge` (her age as a number, only if stated) and `pregnancyWeeks` (only if she stated weeks).
    - Update the endpoint names: Mode A = `POST /chat`; Mode B = `POST /chat/draft` and `POST /questions`.
  - **Ask the reviewing nurse or midwife** whether q02 (baby moving less at 32 weeks) and q12 (soaking pads quickly) should be "emergency". The model routes both there.
  - Re-run the eval after each prompt change until it reports PASS. Paste the score table into the PR.

### H3. App shells, theme and mocks

- Routing (section 3 routes), mobile layout with tab bar, desktop layout with sidebar from 1024px, theme provider (System/Light/Dark), typed API client from `packages/shared`, MSW handlers per endpoint with a per-endpoint real/mock switch.

### H4. Welcome and privacy (W01, W02)

### H5. Women auth (W03, W04, log in)

- Six-box code input with auto-advance, paste and resend countdown.

### H6. Women ask flow (W05–W11, W13)

- Home, chat (with "Ask a nurse directly"), consent, choose who answers (with female-only toggle), confirm and pay, waiting (polls status every 5 s), nurse response (feedback, receipt), emergency.

### H7. History, wallet, account (W12, wallet, account)

- Including Paystack top-up and all settings in section 3.

### H8. Quick exit and PWA

- Quick exit behaviour from section 2; installable PWA; Android install prompt; iPhone instructions; dismissible banner.

### H9. Nurse app (N01–N09, log in, profile)

- Onboarding, under review, today, cases (waiting/active/completed tabs), respond (10-minute countdown, release, checklist, "recommend she sees someone today"), answer sent, earnings (chart + withdraw with code), profile.

### H10. Switch to the real API and test on phones

- Endpoint by endpoint; test on Android and iPhone, including the iPhone home-screen app (may need its own login once).

**Frontend tests (every H task):** each screen renders its states from mocks (loading, empty, error, success); key flows have an interaction test (code entry, consent → send, claim → answer).

---

## 8. Handoffs and status

| Backend task merges | Unlocks for Hikmah                  |
| ------------------- | ----------------------------------- |
| Z1 (types)          | real types in mocks                 |
| Z3                  | H5 auth on real API                 |
| Z4–Z5               | wallet screen on real API           |
| Z6 + Z8             | ask flow on real API                |
| Z7, Z9, Z10         | nurse app on real API               |
| Z11                 | phone testing                       |
| H2 → Z6             | real assistant prompt and red flags |

### Status tracker

Tick in the PR that completes the task.

- [x] Z1 Schema and skeleton
- [x] Z2 x402 proof
- [x] Z3 Auth
- [x] Z4 Wallets
- [x] Z5 Top-up
- [x] Z6 Chat and questions
- [x] Z9 Nurse onboarding + admin
- [x] Z7 Claiming and answering
- [x] Z8 Pay on delivery + payouts
- [x] Z10 Earnings and withdrawals
- [ ] Z11 Deploy
- [ ] Z12 MCP server
- [ ] H1 Tokens
- [ ] H2 Assistant behaviour
- [ ] H3 Shells, theme, mocks
- [ ] H4 Welcome and privacy
- [ ] H5 Women auth
- [ ] H6 Ask flow
- [ ] H7 History, wallet, account
- [ ] H8 Quick exit and PWA
- [ ] H9 Nurse app
- [ ] H10 Real API + phones

---

## 9. Finish together

**End-to-end check (deployed, on a phone):** sign up → wallet created → top up → free AI answer → consent and send → nurse claims and answers → payment and 80% payout on the explorer → red flag shows emergency and creates no question → quick exit can't go Back → same flow from Claude via MCP.

**Demo:** 3-minute script, seeded accounts, rehearse (one as the woman, one as the nurse), record a backup video.

**Submission:** public repo with README, live link and test accounts, demo video, pitch slides, short x402/Stellar write-up, submitted a day early.
