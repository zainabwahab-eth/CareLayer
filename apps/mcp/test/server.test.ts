import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

test('MCP server lists and answers carelayer_ping', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ['carelayer_ping'],
  );

  const result = await client.callTool({ name: 'carelayer_ping', arguments: {} });
  const content = result.content as Array<{ type: string; text: string }>;
  assert.match(content[0]?.text ?? '', /Hello CareLayer/);

  await client.close();
  await server.close();
});
