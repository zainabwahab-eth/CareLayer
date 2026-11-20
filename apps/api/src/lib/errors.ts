// Central error handling. Every error leaves the API as ApiErrorBody (docs/API_CONTRACT.md §0).
import type { ApiErrorBody, ApiErrorCode } from '@carelayer/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from './logger.js';

/** Throw this from any route or service. It becomes `{ error: { code, message, details } }` with `status`. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function body(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiErrorBody {
  return { error: details ? { code, message, details } : { code, message } };
}

/** Mounted after every router: unknown routes get a contract-shaped 404. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(body('NOT_FOUND', `No route for ${req.method} ${req.path}`));
};

/**
 * Mounted last. Known errors keep their status and code. Anything unexpected becomes a 500 with a
 * generic message: stack traces and internal messages are logged, never sent to the client.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const requestId = res.locals.requestId as string | undefined;

    if (err instanceof AppError) {
      res.status(err.status).json(body(err.code, err.message, err.details));
      return;
    }
    if (err instanceof ZodError) {
      // `field` + `message` describe the FIRST problem, so a form can show it next to that input.
      // `issues` lists every problem.
      const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      const first = issues[0];
      res.status(400).json(
        body('VALIDATION_FAILED', first?.message ?? 'Some fields are missing or invalid.', {
          field: first?.path || undefined,
          issues,
        }),
      );
      return;
    }
    // express.json() parse errors and payload-too-large carry a 4xx status.
    const status = typeof err?.status === 'number' ? err.status : undefined;
    if (status === 400 && err?.type === 'entity.parse.failed') {
      res.status(400).json(body('VALIDATION_FAILED', 'Request body is not valid JSON.'));
      return;
    }
    if (status === 413) {
      res.status(413).json(body('VALIDATION_FAILED', 'Request body is too large.'));
      return;
    }

    logger.error('unhandled_error', {
      requestId,
      method: req.method,
      path: req.path,
      error:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : String(err),
    });
    res
      .status(500)
      .json(
        body(
          'INTERNAL',
          'Something went wrong. Please try again.',
          requestId ? { requestId } : undefined,
        ),
      );
  };
}
