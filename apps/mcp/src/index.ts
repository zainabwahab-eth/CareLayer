#!/usr/bin/env node
// CareLayer MCP server entry point.
//
//   stdio (default; Claude Desktop / Claude Code run it locally):
//     CARELAYER_API_URL=...  CARELAYER_AGENT_TOKEN=clat_...  node dist/index.js
//   hosted (Streamable HTTP; each request sends its own agent token as a Bearer header):
//     MCP_TRANSPORT=http  CARELAYER_API_URL=...  PORT=8080  node dist/index.js
//
// stdout carries the MCP protocol in stdio mode, so log to stderr only.
import { AGENT_TOKEN_PREFIX } from '@carelayer/shared';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCareLayerApi } from './api.js';
import { createMcpHttpServer } from './http.js';
import { createServer } from './server.js';

const apiUrl = process.env.CARELAYER_API_URL?.trim();
if (!apiUrl) {
  console.error(
    '[mcp] CARELAYER_API_URL is not set (the CareLayer API, e.g. http://localhost:4000)',
  );
  process.exit(1);
}

if (process.env.MCP_TRANSPORT === 'http') {
  const port = Number(process.env.PORT ?? 8080);
  const server = createMcpHttpServer({ apiUrl });
  server.listen(port, () => console.error(`[mcp] CareLayer MCP (HTTP) on :${port}/mcp`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} else {
  const token = process.env.CARELAYER_AGENT_TOKEN?.trim();
  if (!token?.startsWith(AGENT_TOKEN_PREFIX)) {
    console.error(
      '[mcp] CARELAYER_AGENT_TOKEN is not set: create one in the CareLayer app (Account > Use CareLayer in Claude), it starts with "clat_".',
    );
    process.exit(1);
  }
  const server = createServer(createCareLayerApi({ baseUrl: apiUrl, token }));
  await server.connect(new StdioServerTransport());
  console.error('[mcp] CareLayer MCP server running on stdio');
}
