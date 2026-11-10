import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import type { HealthResponse } from '@carelayer/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let baseUrl = '';
let close: () => void = () => {};

before(async () => {
  const app = createApp(loadConfig({ NODE_ENV: 'test' }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(() => close());

test('GET /health returns ok with the contract version', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as HealthResponse;
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'carelayer-api');
  assert.equal(body.contractVersion, 'v0');
});

test('CORS allows the web app origin', async () => {
  const res = await fetch(`${baseUrl}/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});
