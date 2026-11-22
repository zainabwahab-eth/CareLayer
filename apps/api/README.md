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
