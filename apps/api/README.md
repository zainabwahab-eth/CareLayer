# @carelayer/api

CareLayer backend. Node.js + Express 5 + TypeScript + PostgreSQL via Prisma 7. Owned by Zainab.

## Run

```bash
# from the repo root
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env
npm run db:migrate -w @carelayer/api   # apply migrations to the dev database
npm run db:seed -w @carelayer/api      # wipe + load demo data (refuses NODE_ENV=production)
npm run dev:api                        # http://localhost:4000/health
npm test -w @carelayer/api
```

## Database

- Schema: `prisma/schema.prisma`. Migrations: `prisma/migrations`. Connection URL: `prisma.config.ts` reads `DATABASE_URL`.
- Generated client goes to `src/generated/prisma` (gitignored). `build`, `typecheck` and `test` regenerate it first.
- Uses the `partialIndexes` preview feature for "one active claim per nurse / per question" (`Claim_one_active_per_*`).
- Money: naira as `Int` kobo, USDC as `BigInt` stroops. No float columns (a test checks this). Helpers in `src/lib/money.ts`.
- Privacy: no location, phone or chat-history columns; `EmergencyEvent` is source + timestamp only (tests check this).
- Scripts: `db:migrate` (dev), `db:deploy` (production / CI), `db:seed`, `db:studio`, `db:generate`.

### Seed data

| Who             | Email                         | State                                                                               |
| --------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| Tolu (woman)    | `tolu@example.com`            | 0 free answers left (1 used, 2 held by open questions), ₦0: top up with a test card |
| Amaka Okafor    | `amaka.okafor@example.com`    | Midwife, 9 yrs, English/Igbo, approved                                              |
| Funmilayo Bello | `funmilayo.bello@example.com` | Midwife, 6 yrs, English/Yoruba, approved                                            |
| Hauwa Musa      | `hauwa.musa@example.com`      | Midwife (nurse-midwife), 11 yrs, English/Hausa, approved                            |
| Chiamaka Eze    | `chiamaka.eze@example.com`    | Nurse, pending admin review                                                         |
| Admin           | `admin@example.com`           | Admin                                                                               |

Questions cover every status: answered + collected (free, treasury payout to Amaka), answered not collected, claimed (Hauwa's active lock), open inside a chosen-nurse window, open female-only, open after fallback, expired, cancelled. Times are relative to when the seed runs, so re-seed before a demo.

Placeholders, clearly not real: wallet keys start with `GSEED` (no secret; Z4 creates real testnet wallets), tx hashes are `sha256("carelayer-seed:<label>")` and not on-chain, licence numbers start with `SEED-`.

## Auth (Z3)

- After pulling changes that add env vars, run `npm run env:sync -w @carelayer/api`: it rebuilds `.env` in `.env.example` order, keeps your values, adds new keys with defaults, and moves unknown ones to the bottom (backup in `.env.bak`).
- Set `JWT_ACCESS_SECRET` and `AUTH_PEPPER` in `apps/api/.env` (32+ chars each; the generate command is in `.env.example`). The API refuses to start without them.
- Local sign-in: `POST /auth/code/request`, then copy the code from the `dev_email_code` line in the API log (`EMAIL_TRANSPORT=console`; refused in production), then `POST /auth/code/verify`. Postman: the Auth folder.
- `src/modules/auth/`: `service.ts` (codes, sign-in, sessions, refresh rotation and reuse detection, step-up), `middleware.ts` (`requireAuth`, `requireRole`, `requireFreshCode`), `tokens.ts` (15-min HS256 JWT via `jose`), `crypto.ts` (codes, opaque tokens, peppered HMAC), `cookies.ts` (`cl_refresh`), `email.ts` (`EmailSender`), `google.ts` (`GoogleVerifier`), `router.ts`.
- `/nurse/*` and `/admin/*` are guarded by role on the prefix, so routes added later are protected by default.
- Google sign-in needs `GOOGLE_CLIENT_ID`; without it `POST /auth/google` answers 503.
- Wallets (Z4): `WALLET_ENCRYPTION_KEY` (32 bytes, required; never change it once wallets exist) encrypts wallet secrets. With `STELLAR_TREASURY_SECRET` set, new wallets are activated on testnet right after sign-up and retried every minute while pending; without it they stay `pending`. Code: `src/modules/wallets/` (`crypto.ts`, `chain.ts`, `service.ts`, `router.ts`).
- Real email: `EMAIL_TRANSPORT=resend` + `EMAIL_API_KEY` + `EMAIL_FROM` (on a domain verified in Resend). Check delivery with `npm run email:test -w @carelayer/api -- you@example.com` (sends a sample code that cannot be used).

## Chat, emergencies and questions (Z6)

- **LLM:** any OpenAI-compatible API. Set `LLM_API_KEY` in `apps/api/.env`. The defaults are NVIDIA's free tier (`LLM_BASE_URL`) and `nvidia/nemotron-3-ultra-550b-a55b` (`LLM_MODEL`). OpenAI: change the base URL, model and key. Without a key, `POST /chat` and `/chat/draft` answer 503; the red-flag list still works.
- **Flow:**
  - `POST /chat`: fixed red flags → LLM Mode A (Hikmah's `prompts/assistant.md`) → reply, with a price offer when it suggests a nurse.
  - `POST /chat/draft`: the exact question a nurse would get, signed (`draftToken`).
  - `POST /questions`: stores that draft with her consent and emails the nurses who can take it.
  - Nothing about the chat is stored.
- **Safety in code, not just in the prompt** (`src/modules/llm/assistant.ts`): the clean-up may not shorten her question or drop a number (one retry, then her own words); the age range is computed in code; weeks are kept only if she wrote weeks; a red flag beats an offer. `red-flags.json` is validated at startup.
- **Evals (paid lane, real model):** `npm run eval:assistant -w @carelayer/api` runs Hikmah's test set (`test/fixtures/assistant-test-questions.json`) and the clean-up set (`evals/cleanup-cases.json`). It takes about 4 minutes on the free tier. Report: `evals/reports/<time>.md`. It exits 1 under a threshold (`evals/scoring.ts`; emergency recall must be 100%). Run it before a demo and after any prompt or model change.
- **Trace:** log lines `llm_call` (mode, model, latency, tokens, outcome), `chat_reply`, `chat_draft`, `cleanup_fallback`, `emergency` (source + which layer caught it), `question_created`, `nurse_alerts`. Never her text.
- Code:
  - `src/modules/llm/`: `client.ts`, `assistant.ts`, `errors.ts`.
  - `src/modules/emergency/`: `red-flags.ts`, `service.ts`.
  - `src/modules/chat/`.
  - `src/modules/questions/`: `service.ts`, `pricing.ts`, `draft-token.ts`, `router.ts`.
  - `src/modules/nurses/directory.ts`.

## Claiming and answering (Z7)

- **Approved nurses** use `GET /nurse/questions?tab=waiting|active|completed`, then `POST /nurse/questions/:id/claim` (10-minute lock), then `.../answer` or `.../release`. `GET /nurse/dashboard` serves the Today screen.
- **The sweeper runs every 30 s** (`src/index.ts` → `cases.sweep()`). It expires locks, opens chosen-nurse questions after 10 minutes (emailing the other nurses), and expires questions after 30 minutes. Requests apply the same rules themselves, so a late tick is never wrong.
- **On answer:** the question becomes `answered`, the nurse's average response time is recomputed, and the woman gets a vague "you have a new message" email if she turned that on (`WEB_APP_URL` link).
- **Trace:** log lines `question_claimed`, `question_released`, `question_answered` (with `responseSeconds`), `sweeper`, `nurse_alerts` (with `reason`).
- **Code:** `src/modules/nurses/cases.ts`, `src/modules/questions/alerts.ts`.

## Nurse onboarding and admin verification (Z9)

- **Nurse:** `PATCH /nurse/profile` → upload the 4 documents (`POST /nurse/documents`, multipart `type` + `file`) → `POST /nurse/profile/submit`. Licence fields and documents lock while under review and once approved.
- **Admin:** open **http://localhost:4000/admin-console** and sign in as `admin@example.com`. Take the code from the `dev_email_code` line in the API log. Review pending nurses, open their documents and approve or reject. The API version is `GET/POST /admin/nurses*`.
- **Documents live in Postgres** (`NurseDocumentFile`). They are only readable through signed 10-minute links from `GET /admin/nurses/:id`, and the type is detected from the bytes. Code: `src/modules/nurses/documents.ts`.
- **Unapproved nurses** get 403 `NURSE_NOT_APPROVED` on `/nurse/questions*` and `/nurse/claim`.
- **Trace:** log lines `nurse_document_uploaded`, `nurse_submitted`, `admin_viewed_nurse`, `nurse_document_viewed` (with the admin id), `nurse_reviewed`, `nurse_payout_address_changed`.
- **Code:**
  - `src/modules/nurses/`: `profile.ts`, `documents.ts`, `router.ts`.
  - `src/modules/admin/`: `service.ts`, `router.ts`, `console.ts`.

## Pay on delivery and nurse payouts (Z8)

- **Web app:** `POST /me/questions/:id/collect` once the question is `answered`. The API's own agent decides free or paid. For a paid answer it checks her limit and balance, then pays over x402 from her custodial wallet.
- **Any x402 agent:** `GET /questions/:id/answer` answers 409 (not answered, no payment asked), then 402 + `PAYMENT-REQUIRED`. The paid retry carries `PAYMENT-SIGNATURE` and gets the answer + `PAYMENT-RESPONSE`.
- **The answer is only read after settlement succeeds** (manual x402 flow, not `paymentMiddleware`: see the Z8 decisions in `docs/TASKS.md`). An unclear settle (timeout) stays pending and is found on chain before she is ever asked to pay again.
- **Payouts:** the nurse's 80% is a treasury USDC payment (memo = payout id), sent right after collection. A loop retries it every minute (`src/index.ts`). Free answers are paid the same way.
- **Feedback:** `POST /questions/:id/feedback { helpful }` after collection. It recomputes her % helpful.
- **End to end on testnet:** `npm run answer:e2e -w @carelayer/api` prints both explorer links: her payment and the nurse payout. It needs `testnet:setup` and a migrated dev database.
- **Trace:** log lines `answer_collected`, `x402_settle_rejected` / `x402_settle_indeterminate` / `x402_settle_failed`, `payment_reconciled`, `payout_confirmed`, `payout_failed`, `payout_loop`.
- **Code:**
  - `src/modules/questions/answers.ts`.
  - `src/modules/payments/`: `answer-x402.ts`, `payouts.ts`, `chain.ts`.

## Earnings and withdrawals (Z10)

- **`GET /nurse/earnings`** serves N09:
  - Available to withdraw.
  - The Mon–Sun chart, this week, this month and all time.
  - Recent earnings and withdrawals.
- **`POST /nurse/withdrawals`** needs a fresh code (`POST /auth/step-up`). It is a Stellar address only, ₦100 minimum, one at a time. Her custodial key signs; the treasury pays the fee (fee bump).
- **Memo:** optional `destination.memo` (`text` or `id`), for exchanges that need one.
- **`GET /nurse/withdrawals`** lists her withdrawals. A withdrawal whose outcome was unknown (`submitted`) is settled by a loop every minute (`src/index.ts`). The loop looks up the transaction hash stored before submitting.
- **End to end on testnet:** `npm run withdrawal:e2e -w @carelayer/api` (withdraws ₦100 with a memo ID and checks it arrived).
- **Trace:** log lines `withdrawal_created`, `withdrawal_confirmed`, `withdrawal_rejected`, `withdrawal_outcome_unknown`, `withdrawal_loop`.
- **Code:** `src/modules/nurses/earnings.ts`, `src/modules/payments/withdrawal-chain.ts`.

## x402 on Stellar testnet (Z2)

```bash
npm run testnet:setup -w @carelayer/api   # once: treasury + test payer wallets, USDC, facilitator key -> .env
# set X402_TEST_ROUTE=true in apps/api/.env, then:
npm run dev:api
npm run x402:pay -w @carelayer/api        # 409 guard check, then pays 0.01 USDC and prints the tx link
npm run test:testnet -w @carelayer/api    # same, as assertions (real testnet, not part of npm test)
```

- Packages: official `@x402/core`, `@x402/express`, `@x402/stellar`, `@x402/fetch` (2.31.0). Facilitator: OpenZeppelin Channels (fees sponsored). Why: decisions log in `docs/TASKS.md`.
- `src/modules/payments/`: `guard.ts` (pay-on-delivery guard, 409 before any 402), `x402.ts` (facilitator client, resource server, USDC prices in stroops), `x402-client.ts` (paying agent: `createPayingFetch`, `readSettlement`), `stellar-testnet.ts` (Friendbot, trustline, XLM to USDC on the testnet DEX, balances), `router.ts` (`GET /x402-test`).
- `testnet:setup` only fills empty `.env` values and never prints secrets. Re-running it is safe.
- First proof payment: https://stellar.expert/explorer/testnet/tx/b2ce568136e4372c5b5faa5ab963ebeac8ad94afaa661bb2ccbf2f6b09ef30ed

## Deploy (Z11): Google Cloud Run + Neon

One always-on Cloud Run instance (the background loops and the in-memory rate limit need exactly one), a Neon Postgres, secrets in Google Secret Manager. Region `europe-west3` (Frankfurt), next to Neon's `eu-central-1`. The image is the repo-root `Dockerfile`; `deploy/cloudrun.sh` does every step.

**Accounts (once, by you):**

1. **Neon** (free): create a project in **AWS Europe Central 1 (Frankfurt)**, database `carelayer`. Copy the **direct** connection string (not "pooled").
2. **Resend:** verify your domain (DNS records), create an API key with sending access.
3. **Google Cloud:** a project with billing on.
   - `gcloud auth login && gcloud config set project <id>`.
   - Or use **Cloud Shell** in the browser: gcloud is already there. `git clone` the repo and upload `.env.production` with the Upload button.

**Fill the production env file** (gitignored, never commit it):

```bash
cp apps/api/deploy/.env.production.example apps/api/deploy/.env.production
# A separate testnet treasury + facilitator key for the deployed API:
CARELAYER_ENV_FILE=deploy/.env.production npm run testnet:setup -w @carelayer/api
# Then fill: DATABASE_URL (Neon), the 3 generated secrets, EMAIL_FROM + EMAIL_API_KEY (Resend),
# LLM_API_KEY, PAYSTACK_* (test keys), GOOGLE_CLIENT_ID, and Hikmah's frontend URLs.
```

**Deploy:**

```bash
apps/api/deploy/cloudrun.sh setup     # once: APIs, image registry, service account
apps/api/deploy/cloudrun.sh secrets   # uploads the secrets to Secret Manager (values never printed)
apps/api/deploy/cloudrun.sh release   # Cloud Build image -> migrations job -> deploy service
SEED_ADMIN_EMAIL=you@yourdomain.com \
  apps/api/deploy/cloudrun.sh seed    # ONCE, on the fresh database: demo accounts + your admin
apps/api/deploy/cloudrun.sh url       # the API URL: check <url>/health
```

- **Every later release:** `secrets` if a secret changed, then `release`. Migrations run as a Cloud Run job before the new revision.
- **Changing a plain setting** (e.g. Hikmah's URLs in `CORS_ORIGINS`): edit `.env.production`, then run `deploy`.
- **The seed wipes every table.** In production it needs `CARELAYER_SEED_PRODUCTION=wipe-and-seed` (the `seed` command sets it). It still refuses once any real account (an email not ending in `@example.com`) exists.
- **The seeded admin** gets `SEED_ADMIN_EMAIL` (an inbox you own), because `/admin-console` sign-in codes are emailed. Locally it stays `admin@example.com`.
- **Logs:** Cloud Run → `carelayer-api` → Logs. Every line is JSON with a `severity`.
- **Postman:** the environment "CareLayer Cloud Run" (`docs/postman/carelayer.cloudrun.postman_environment.json`). Set `baseUrl` to the URL.

## Layout

- `src/app.ts`: Express app factory. Takes `AppDeps` (`config`, `db`, `logger`) so tests inject their own.
- `src/config.ts`: env validation with zod; fails fast listing every bad variable. Add each new env var here and to `.env.example`.
- `src/db.ts`: Prisma client (node-postgres adapter) and `pingDatabase` (2 s timeout).
- `src/lib/`: `errors.ts` (AppError + central handler, contract-shaped errors, no stack leaks), `logger.ts` (JSON lines), `request-logger.ts` (request id + one log line per request; never bodies or query strings), `money.ts`.
- `src/modules/<name>/router.ts`: auth, users, wallets, topups, chat, questions, nurses, payments, admin (empty until its task), plus health. Shared helpers: `src/modules/llm/`, `src/modules/emergency/`.
- `src/seed/`: `seed.ts` (logic, used by tests) and `run.ts` (CLI).
- `prompts/assistant.md`, `config/red-flags.json`: owned by Hikmah.

## Tests

Vitest + Supertest. `npm test` creates a throwaway database `carelayer_<timestamp>_test` on the server in `DATABASE_URL_TEST`, runs `prisma migrate deploy` on it (the fresh-migration check), runs the suite, then drops it. It never touches the dev database.
