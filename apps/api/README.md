# @carelayer/api

CareLayer backend. Node.js + Express 5 + TypeScript + PostgreSQL via Prisma 7. Owned by Zainab.

## Run

```bash
# from the repo root
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env
npm run dev:api            # http://localhost:4000/health
npm test -w @carelayer/api
```

## Database

- Schema: `prisma/schema.prisma` (no models yet). Connection URL: `prisma.config.ts` reads `DATABASE_URL`.
- Generated client goes to `src/generated/prisma` (gitignored). Prisma 7 needs the `@prisma/adapter-pg` driver adapter when you instantiate the client.
- `npm run db:migrate -w @carelayer/api` after adding models, `npm run db:generate -w @carelayer/api` to regenerate, `npm run db:studio -w @carelayer/api` to browse.

## Layout

- `src/app.ts`: Express app factory (tests start it on a random port).
- `src/config.ts`: env parsing with zod. Add every new env var here and to `.env.example`.
- `prompts/assistant.md`: assistant system prompt (owned by Hikmah).
- `config/red-flags.json`: fixed red-flag symptom list, checked before anything else (owned by Hikmah).
- `test/`: Node test runner via `tsx --test`.

Endpoints to build: see `docs/API_CONTRACT.md`.
