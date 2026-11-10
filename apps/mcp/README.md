# @carelayer/mcp

MCP server that lets a woman use CareLayer inside Claude. TypeScript + official `@modelcontextprotocol/sdk`, stdio transport. Owned by Zainab.

## Run

```bash
# from the repo root
cp apps/mcp/.env.example apps/mcp/.env
npm run dev:mcp                     # stdio; logs go to stderr
npm run inspect -w @carelayer/mcp   # MCP Inspector in the browser
npm test -w @carelayer/mcp
```

## Add to Claude Desktop / Claude Code (after `npm run build:mcp`)

```json
{
  "mcpServers": {
    "carelayer": {
      "command": "node",
      "args": ["/absolute/path/to/carelayer/apps/mcp/dist/index.js"],
      "env": { "CARELAYER_API_URL": "http://localhost:4000", "CARELAYER_AGENT_TOKEN": "..." }
    }
  }
}
```

## Status

Only a `carelayer_ping` tool exists. Planned tools (`ask_health_worker`, `get_answer`, `check_balance`) are specified in `docs/API_CONTRACT.md` §13. Never write to stdout except through the SDK: it carries the protocol.
