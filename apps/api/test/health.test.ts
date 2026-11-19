import { API_CONTRACT_VERSION, type HealthResponse } from '@carelayer/shared';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { buildTestApp, deadDb } from './helpers/app.js';
import { testDatabaseUrl } from './helpers/env.js';

const db = createDb(testDatabaseUrl());
afterAll(() => db.$disconnect());

describe('GET /health', () => {
  it('returns 200 with database ok when Postgres answers', async () => {
    const res = await request(buildTestApp(db)).get('/health');
    expect(res.status).toBe(200);
    const body = res.body as HealthResponse;
    expect(body).toMatchObject({
      status: 'ok',
      database: 'ok',
      service: 'carelayer-api',
      contractVersion: API_CONTRACT_VERSION,
    });
    expect(Date.parse(body.time)).not.toBeNaN();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 with database down when the query fails', async () => {
    const res = await request(buildTestApp(deadDb('reject'))).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'unavailable', database: 'down' });
  });

  it('returns 503 instead of hanging when the database never answers', async () => {
    const started = Date.now();
    const res = await request(buildTestApp(deadDb('hang'))).get('/health');
    expect(res.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('returns 503 against a real Postgres URL that nothing listens on', async () => {
    const unreachable = createDb('postgresql://carelayer:carelayer@127.0.0.1:1/carelayer_test');
    try {
      const res = await request(buildTestApp(unreachable)).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.database).toBe('down');
    } finally {
      await unreachable.$disconnect().catch(() => {});
    }
  });

  it('allows the web app origin (CORS)', async () => {
    const res = await request(buildTestApp(db))
      .get('/health')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
