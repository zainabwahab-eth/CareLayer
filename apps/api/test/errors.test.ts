import type { ApiErrorBody } from '@carelayer/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, errorHandler, notFoundHandler } from '../src/lib/errors.js';
import { createLogger, type LogSink } from '../src/lib/logger.js';
import { requestLogger } from '../src/lib/request-logger.js';
import { buildTestApp, deadDb } from './helpers/app.js';

function appWith(route: express.RequestHandler, sink: LogSink = () => {}) {
  const logger = createLogger('debug', sink);
  const app = express();
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '1kb' }));
  app.post('/boom', route);
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

describe('central error handling', () => {
  it('unknown routes return a contract-shaped 404', async () => {
    const res = await request(buildTestApp(deadDb())).get('/nope');
    expect(res.status).toBe(404);
    expect((res.body as ApiErrorBody).error.code).toBe('NOT_FOUND');
  });

  it('AppError keeps its status, code and details', async () => {
    const app = appWith(() => {
      throw new AppError(409, 'ACTIVE_CLAIM_EXISTS', 'You already have a question in progress.', {
        questionId: 'q1',
      });
    });
    const res = await request(app).post('/boom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'ACTIVE_CLAIM_EXISTS',
        message: 'You already have a question in progress.',
        details: { questionId: 'q1' },
      },
    });
  });

  it('async errors (Express 5) are caught too', async () => {
    const app = appWith(async () => {
      await Promise.resolve();
      throw new AppError(410, 'CLAIM_EXPIRED', 'Your claim expired.');
    });
    const res = await request(app).post('/boom');
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('CLAIM_EXPIRED');
  });

  it('zod errors become 400 VALIDATION_FAILED with field paths', async () => {
    const app = appWith((req) => {
      z.object({ text: z.string().min(1) }).parse(req.body);
    });
    const res = await request(app).post('/boom').send({ text: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.issues[0].path).toBe('text');
  });

  it('malformed JSON becomes 400 VALIDATION_FAILED', async () => {
    const app = appWith((_req, res) => void res.json({}));
    const res = await request(app)
      .post('/boom')
      .set('Content-Type', 'application/json')
      .send('{"text":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('oversized bodies become 413', async () => {
    const app = appWith((_req, res) => void res.json({}));
    const res = await request(app)
      .post('/boom')
      .send({ text: 'x'.repeat(5000) });
    expect(res.status).toBe(413);
  });

  it('unexpected errors become a generic 500: no internal message or stack leaks', async () => {
    const lines: string[] = [];
    const app = appWith(
      () => {
        throw new Error('db password is hunter2');
      },
      (_level, line) => lines.push(line),
    );
    const res = await request(app).post('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(res.body.error.details.requestId).toBe(res.headers['x-request-id']);
    // ...but it is logged for us.
    expect(lines.some((l) => l.includes('unhandled_error') && l.includes('hunter2'))).toBe(true);
  });
});

describe('request logging', () => {
  it('logs method, path, status and duration, but never the query string or body', async () => {
    const lines: string[] = [];
    const app = appWith(
      (_req, res) => void res.status(201).json({ ok: true }),
      (_l, line) => lines.push(line),
    );
    const res = await request(app)
      .post('/boom?email=tolu@example.com')
      .send({ text: 'my private question' });
    expect(res.status).toBe(201);

    const entry = JSON.parse(lines.find((l) => l.includes('"event":"request"'))!);
    expect(entry).toMatchObject({ level: 'info', method: 'POST', path: '/boom', status: 201 });
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.requestId).toBe(res.headers['x-request-id']);
    const all = lines.join('\n');
    expect(all).not.toContain('tolu@example.com');
    expect(all).not.toContain('my private question');
  });

  it('reuses a well-formed incoming X-Request-Id and replaces a malformed one', async () => {
    const app = appWith((_req, res) => void res.json({}));
    const good = await request(app).post('/boom').set('X-Request-Id', 'abc12345-trace');
    expect(good.headers['x-request-id']).toBe('abc12345-trace');
    const bad = await request(app).post('/boom').set('X-Request-Id', '<script>');
    expect(bad.headers['x-request-id']).not.toBe('<script>');
  });

  it('logs 4xx as warn and 5xx as error', async () => {
    const lines: string[] = [];
    const app = appWith(
      () => {
        throw new Error('x');
      },
      (_l, line) => lines.push(line),
    );
    await request(app).post('/boom');
    await request(app).post('/missing');
    const requests = lines.map((l) => JSON.parse(l)).filter((e) => e.event === 'request');
    expect(requests.map((e) => [e.status, e.level])).toEqual([
      [500, 'error'],
      [404, 'warn'],
    ]);
  });
});
