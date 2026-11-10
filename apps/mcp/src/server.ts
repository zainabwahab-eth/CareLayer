// CareLayer MCP server factory. Kept separate from index.ts so tests can connect in memory.
//
// Planned tools (NOT built yet, see docs/PROJECT_BRIEF.md §9 and docs/API_CONTRACT.md §13):
//   ask_health_worker  - requires explicit confirmation of the price
//   get_answer         - pays from her CareLayer wallet within her Claude spending limit
//   check_balance
// Emergencies get the same free response as the web app.
import { API_CONTRACT_VERSION } from '@carelayer/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const SERVER_NAME = 'carelayer';
export const SERVER_VERSION = '0.0.0';

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'carelayer_ping',
    {
      title: 'CareLayer ping',
      description: 'Checks that the CareLayer MCP server is running. Takes no input.',
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: `Hello CareLayer (MCP server ${SERVER_VERSION}, API contract ${API_CONTRACT_VERSION})`,
        },
      ],
    }),
  );

  return server;
}
