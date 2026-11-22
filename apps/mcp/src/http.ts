// Hosted mode (Streamable HTTP), for Claude Code and other clients that can send a header:
//   POST /mcp  with  Authorization: Bearer <her agent token>
// Stateless: every request gets its own server + transport, bound to the token in THAT request, so
// one woman's token can never serve another's call. The token is passed through to the API and
// never stored or logged here.
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { AGENT_TOKEN_PREFIX } from '@carelayer/shared';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createCareLayerApi } from './api.js';
import { createServer } from './server.js';

const MAX_BODY_BYTES = 1_000_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

export function createMcpHttpServer(opts: { apiUrl: string; fetch?: typeof fetch }): Server {
  return createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/health') {
      json(200, { status: 'ok', service: 'carelayer-mcp' });
      return;
    }
    if (url.pathname !== '/mcp') {
      json(404, { error: 'not found' });
      return;
    }
    if (req.method !== 'POST') {
      // Stateless server: no server-initiated stream (GET) and no session to delete (DELETE).
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }

    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    const token = match?.[1];
    if (!token?.startsWith(AGENT_TOKEN_PREFIX)) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="carelayer"',
      });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message:
              'Add your CareLayer agent token as "Authorization: Bearer clat_..." (create one in the CareLayer app).',
          },
          id: null,
        }),
      );
      return;
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      json(400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
      return;
    }

    const server = createServer(
      createCareLayerApi({ baseUrl: opts.apiUrl, token, fetch: opts.fetch }),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error('[mcp] request failed:', (err as Error).message);
      if (!res.headersSent) {
        json(500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
    }
  });
}
