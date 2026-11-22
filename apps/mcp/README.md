# @carelayer/mcp

The CareLayer MCP server: a woman asks a verified Nigerian nurse or midwife **from inside Claude**, and pays per answer from her CareLayer wallet (x402 on Stellar). TypeScript, official `@modelcontextprotocol/sdk`. Owned by Zainab. Contract: `docs/API_CONTRACT.md` §13.

## Tools

| Tool                | What it does                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ask_health_worker` | **Two steps.** (1) Her question → the price (or "free") and exactly what the nurse will see. Nothing is sent. (2) Only after she says yes: `confirm: true` + the `draftToken` sends it. An emergency returns the same free guidance as the web app, and nothing is sent. |
| `get_answer`        | Waiting / a nurse is writing / expired (not charged) / **the answer**. Paid from her CareLayer wallet over x402. If she chose "ask before each payment", it asks first (`confirmPayment: true` after she agrees). Never charges twice.                                   |
| `get_balance`       | Her balance (naira, held as USDC) and free answers left.                                                                                                                                                                                                                 |

The API enforces the rules, whatever the client does:

- the agent token works only on 5 routes;
- Claude's own spending limit applies (default ₦500 per answer; she changes it in the app);
- "ask before each payment" is on by default.

## 1. Get an agent token (her "Claude connection")

In the CareLayer app: **Account → Use CareLayer in Claude → Create connection**. Hikmah's screen calls `POST /auth/agent-tokens`. The token starts with `clat_` and is shown once. She can remove it there at any time, which takes effect immediately.

Before that screen exists, use the API directly with her signed-in access token (Postman: Auth → "Create Claude connection"):

```bash
curl -X POST "$API/auth/agent-tokens" -H "Authorization: Bearer <her access token>" \
  -H "Content-Type: application/json" -d '{"label":"Claude Desktop"}'
```

## 2a. Claude Desktop (local, stdio)

```bash
npm run build:mcp     # from the repo root: builds apps/mcp/dist
```

Then add this to `claude_desktop_config.json`. On macOS it's `~/Library/Application Support/Claude/`; you can also open it from Settings → Developer → Edit Config. Restart Claude Desktop afterwards.

```json
{
  "mcpServers": {
    "carelayer": {
      "command": "node",
      "args": ["/absolute/path/to/carelayer/apps/mcp/dist/index.js"],
      "env": {
        "CARELAYER_API_URL": "https://carelayer-api-598920525559.europe-west2.run.app",
        "CARELAYER_AGENT_TOKEN": "clat_..."
      }
    }
  }
}
```

## 2b. Claude Code

Hosted (no local install). The token travels as a header and is passed straight to the API:

```bash
claude mcp add --transport http carelayer \
  "$(apps/api/deploy/cloudrun.sh mcp-url)" \
  --header "Authorization: Bearer clat_..."
```

Or local (stdio):

```bash
claude mcp add carelayer \
  --env CARELAYER_API_URL=https://carelayer-api-598920525559.europe-west2.run.app \
  --env CARELAYER_AGENT_TOKEN=clat_... \
  -- node /absolute/path/to/carelayer/apps/mcp/dist/index.js
```

Then ask Claude, for example: _"Ask a CareLayer nurse: my period is two weeks late, could I be pregnant?"_

**claude.ai on the web** ("Add custom connector") needs the hosted server **with OAuth sign-in**, which is not built (see `docs/TASKS.md` Z12). Use Claude Desktop or Claude Code.

## Develop

```bash
cp apps/mcp/.env.example apps/mcp/.env      # CARELAYER_API_URL + CARELAYER_AGENT_TOKEN
npm run dev:mcp                             # stdio; logs go to stderr
MCP_TRANSPORT=http PORT=8787 npm run dev -w @carelayer/mcp   # hosted mode on :8787/mcp
npm run inspect -w @carelayer/mcp           # MCP Inspector in the browser
npm test -w @carelayer/mcp                  # tools against a fake API, and HTTP mode
```

- **End to end on testnet** (the two-agent demo): `E2E_LLM_ENV_FILE=deploy/.env.production npm run two-agent:e2e -w @carelayer/api`.
- **Hosted on Cloud Run:** `apps/api/deploy/cloudrun.sh deploy-mcp`, which builds from `Dockerfile.mcp`. The service scales to zero.
- In stdio mode, **never write to stdout** except through the SDK: stdout carries the protocol.
