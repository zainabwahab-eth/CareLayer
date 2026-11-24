# CareLayer

CareLayer is an open network of verified, registered Nigerian nurses and midwives that any AI health agent can call and pay per answer.

- Women ask an AI assistant for free.
- When a question needs a professional, the assistant sends it to a verified health worker, but only with her consent.
- The answer is paid for with x402 agentic payments in USDC on Stellar, and the health worker gets their share straight away.
- Any agent can use the network: our web app, Claude through our MCP server, or other apps.

Built for the EmpowerHer: Building the Agent Economy hackathon.

## Live

| What                         | Link                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Women's app and landing page | [www.carelayer.health](https://www.carelayer.health)                                                             |
| Health worker app            | [care-layer-workers.vercel.app](https://care-layer-workers.vercel.app)                                           |
| API                          | [api.carelayer.health](https://api.carelayer.health/health) (`/health` returns `{ "status": "ok" }`)             |
| Admin console (licences)     | [api.carelayer.health/admin-console](https://api.carelayer.health/admin-console)                                 |
| MCP server for Claude        | `https://mcp.carelayer.health/mcp` (setup: [`apps/mcp/README.md`](apps/mcp/README.md))                           |
| API docs (Postman)           | [documenter.getpostman.com/view/44554019/2sBYPv3YMs](https://documenter.getpostman.com/view/44554019/2sBYPv3YMs) |

Everything runs on **test money**:

- Top-ups use Paystack test mode. Use a Paystack test card, not a real one.
- USDC payments are on the Stellar **testnet**. Every transaction can be checked on [stellar.expert (testnet)](https://stellar.expert/explorer/testnet).

## How it works

```mermaid
sequenceDiagram
    autonumber
    actor W as Woman
    participant A as AI assistant<br/>(web app or Claude via MCP)
    participant API as CareLayer API
    participant N as Nurse / midwife
    participant S as Stellar testnet

    W->>A: Asks in her own words
    A->>API: POST /chat
    API-->>A: Red-flag check first. An emergency gets free urgent guidance and is never sent to a nurse.
    API-->>A: Otherwise a free AI answer, plus a nurse offer only if her situation needs judging
    W->>A: "Send to a nurse": reviews exactly what is shared and agrees
    A->>API: POST /questions (consent recorded, nothing charged yet)
    N->>API: Sees the question in the queue, claims it and answers
    API-->>W: "A nurse answered" (in the app, and by email if she turned it on)
    A->>API: Open the answer
    Note over API: x402 pay on delivery: GET /questions/:id/answer returns 402 with the price in USDC.<br/>The payment is signed from her custodial CareLayer wallet and sent back in PAYMENT-SIGNATURE.
    API->>S: Settle through the x402 facilitator
    API-->>W: The answer, the nurse's name and role, and a Stellar receipt
    API->>S: 80% paid to the nurse's wallet (20% platform)
    N->>S: Withdraws USDC to any Stellar wallet
```

### For women ([www.carelayer.health](https://www.carelayer.health))

1. **Sign in** with an emailed code (no password). A custodial Stellar wallet is created for her automatically. She never needs XLM or a crypto wallet of her own.
2. **Chat with the assistant.** AI answers are free. Every message is checked for emergencies first (a fixed red-flag list plus the LLM). An emergency gets clear urgent-care guidance and is never charged or queued.
3. **The nurse offer.** General questions are just answered. When her own situation needs a professional to judge, the assistant offers a nurse and says why in one sentence. She can also ask a nurse directly at any time.
4. **Send to a nurse (3 steps):**
   - **What's shared:** exactly what the nurse will see. She can edit the question and remove the assistant's notes. Never her name, email, phone or location.
   - **Who answers:** the first available nurse, or a chosen one. There is an "Only female health workers" option.
   - **Confirm:** the price, or free for her first 3 answers. Nothing is charged until an answer arrives. She can ask to be emailed when it is answered (the email holds no health details).
5. **Waiting.** If no nurse answers within 30 minutes (up to 40 if one is mid-answer), the question expires and she pays nothing.
6. **Her answer.** Paid on delivery over x402 from her wallet. She sees the nurse's name and verified role, a "see someone today" note if the nurse ticked it, and the Stellar receipt. She can rate it helpful or not. The answer also appears in the chat she asked from.
7. **Top up** in naira with Paystack (test mode). The same value arrives in her wallet as USDC.
8. **Safety:**
   - Quick exit on every screen.
   - Her chats and questions are listed in History. She can delete a chat.
   - Nurses never see who she is.

### For health workers ([care-layer-workers.vercel.app](https://care-layer-workers.vercel.app))

1. **Sign up** with their licence details. An admin approves the licence in the admin console before they can answer.
2. **Answer:**
   - The queue shows the questions they can take.
   - Claiming one locks it for 10 minutes.
   - They answer and can tick "Recommend she sees someone today".
3. **Earn and withdraw:**
   - 80% of each answer goes to their wallet as USDC.
   - They withdraw to any Stellar address. Sending money out needs an emailed code.

### For other agents (Claude)

The MCP server gives Claude three tools: `ask_health_worker`, `get_answer` and `get_balance`. The woman connects Claude from **Account → Use CareLayer in Claude** in the app. Claude then follows the same rules as the app:

- Consent first.
- Her own spending limit.
- It asks before each payment, unless she turns that off.

Setup: [`apps/mcp/README.md`](apps/mcp/README.md).

## Setup (local)

Requirements: Node.js 22.12+ (24 recommended, see `.nvmrc`), npm 10+, Docker.

```bash
git clone https://github.com/zainabwahab-eth/CareLayer.git carelayer && cd carelayer
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
| Women's app + landing | http://localhost:5173        | The CareLayer landing page                                       |
| Health worker app     | http://localhost:5174        | "CareLayer for Health Workers"                                   |
| MCP server            | `npm run dev:mcp` (stdio)    | `npm run inspect -w @carelayer/mcp`                              |

Sign-in codes are printed in the API's console locally. The seeded accounts are listed in [`apps/api/README.md`](apps/api/README.md#seed-data).

Other root scripts: `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run format`.

Deploying the API (Google Cloud Run + Neon): see "Deploy" in [`apps/api/README.md`](apps/api/README.md).

## Repository layout

```
apps/web        Landing page + women's app (React, Vite, PWA)
apps/workers    Health worker app (React, Vite, PWA)
apps/api        Backend (Express, Prisma, PostgreSQL, x402, Stellar)
apps/mcp        MCP server for Claude
packages/tokens Design tokens (tokens.css)
packages/shared Shared types and API contract types
docs/           Brief, API contract, task guide, Postman collection
```

## Docs

- [Project brief](docs/PROJECT_BRIEF.md)
- [API contract (v1)](docs/API_CONTRACT.md)
- [API docs on Postman](https://documenter.getpostman.com/view/44554019/2sBYPv3YMs) (collection and environments also in [`docs/postman/`](docs/postman/))
- [Task guide](docs/TASKS.md)
- [CLAUDE.md](CLAUDE.md): rules for AI coding agents working in this repo
