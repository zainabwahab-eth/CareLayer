// Request logging: assigns a request id (X-Request-Id) and logs one line per finished request.
// Logs method, route path, status and duration only. Never query strings, bodies or headers
// (they can contain question text, emails, codes or tokens).
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from './logger.js';

const INCOMING_ID = /^[A-Za-z0-9-]{8,64}$/;

export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const requestId = incoming && INCOMING_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
      const fields = {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
      };
      if (res.statusCode >= 500) logger.error('request', fields);
      else if (res.statusCode >= 400) logger.warn('request', fields);
      else logger.info('request', fields);
    });
    next();
  };
}
