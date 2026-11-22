# CareLayer

CareLayer is an open network of verified, registered Nigerian nurses and midwives that any AI health agent can call and pay per answer. Women ask an AI assistant for free; when a question needs a professional, the assistant sends it (with her consent) to a verified health worker, and pays for the answer with x402 agentic payments in USDC on Stellar. The health worker is paid instantly, and any agent can use the network: our web app, Claude through our MCP server, or other apps.

Built for the EmpowerHer: Building the Agent Economy hackathon.

## Setup

Requirements: Node.js 22.12+ (24 recommended, see `.nvmrc`), npm 10+, Docker.

```bash
git clone <repo-url> carelayer && cd carelayer
npm install                      # installs every workspace and builds packages/shared
docker compose up -d postgres    # Postgres on localhost:5432 (user/pass/db: carelayer)

# Copy each env example (never commit the copies)
cp apps/api/.env.example apps/api/.env
cp apps/mcp/.env.example apps/mcp/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/workers/.env.example apps/workers/.env.local

npm run db:migrate -w @carelayer/api   # apply migrations
npm run db:seed -w @carelayer/api      # demo data (Tolu, three midwives, a pending nurse, an admin)
npm run dev
```

| App                   | URL                          | Check                                                            |
| --------------------- | ---------------------------- | ---------------------------------------------------------------- |
| API                   | http://localhost:4000/health | `{ "status": "ok", "database": "ok" }` (503 if Postgres is down) |
| Women's app + landing | http://localhost:5173        | "Hello CareLayer"                                                |
| Health worker app     | http://localhost:5174        | "Hello CareLayer"                                                |
| MCP server            | `npm run dev:mcp` (stdio)    | `npm run inspect -w @carelayer/mcp`                              |

Other root scripts: `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run format`.

Deploying the API (Google Cloud Run + Neon): see "Deploy" in [`apps/api/README.md`](apps/api/README.md).

## Repository layout

```
apps/web        Landing page + women's app (React, Vite, PWA)
apps/workers    Health worker app (React, Vite, PWA)
apps/api        Backend (Express, Prisma, PostgreSQL)
apps/mcp        MCP server for Claude
packages/tokens Design tokens (tokens.css)
packages/shared Shared types and API contract types
docs/           Brief, API contract, task guide
```

## Docs

- [Project brief](docs/PROJECT_BRIEF.md)
- [API contract (v0)](docs/API_CONTRACT.md)
- [Task guide](docs/TASKS.md)
- [CLAUDE.md](CLAUDE.md): rules for AI coding agents working in this repo
