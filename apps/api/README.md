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

| Who               | Email                         | State                                                         |
| ----------------- | ----------------------------- | ------------------------------------------------------------- |
| Tolu (woman)      | `tolu@example.com`            | 2 of 3 free answers left, cached balance ₦3,500               |
| Amaka Okafor      | `amaka.okafor@example.com`    | Midwife, 9 yrs, English/Igbo, approved                        |
| Funmilayo Bello   | `funmilayo.bello@example.com` | Midwife, 6 yrs, English/Yoruba, approved                      |
| Hauwa Musa        | `hauwa.musa@example.com`      | Midwife (nurse-midwife), 11 yrs, English/Hausa, approved      |
| Chiamaka Eze      | `chiamaka.eze@example.com`    | Nurse, pending admin review                                   |
| Admin             | `admin@example.com`           | Admin                                                         |

Questions cover every status: answered + collected (free, treasury payout to Amaka), answered not collected, claimed (Hauwa's active lock), open inside a chosen-nurse window, open female-only, open after fallback, expired, cancelled. Times are relative to when the seed runs, so re-seed before a demo.

Placeholders, clearly not real: wallet keys start with `GSEED` (no secret; Z4 creates real testnet wallets), tx hashes are `sha256("carelayer-seed:<label>")` and not on-chain, licence numbers start with `SEED-`.

## Layout

- `src/app.ts`: Express app factory. Takes `AppDeps` (`config`, `db`, `logger`) so tests inject their own.
- `src/config.ts`: env validation with zod; fails fast listing every bad variable. Add each new env var here and to `.env.example`.
- `src/db.ts`: Prisma client (node-postgres adapter) and `pingDatabase` (2 s timeout).
- `src/lib/`: `errors.ts` (AppError + central handler, contract-shaped errors, no stack leaks), `logger.ts` (JSON lines), `request-logger.ts` (request id + one log line per request; never bodies or query strings), `money.ts`.
- `src/modules/<name>/router.ts`: auth, users, wallets, chat, questions, nurses, payments, admin (empty until their task), plus health.
- `src/seed/`: `seed.ts` (logic, used by tests) and `run.ts` (CLI).
- `prompts/assistant.md`, `config/red-flags.json`: owned by Hikmah.

## Tests

Vitest + Supertest. `npm test` creates a throwaway database `carelayer_<timestamp>_test` on the server in `DATABASE_URL_TEST`, runs `prisma migrate deploy` on it (the fresh-migration check), runs the suite, then drops it. It never touches the dev database.
