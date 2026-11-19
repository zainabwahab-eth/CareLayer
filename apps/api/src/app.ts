// Express app factory. Kept separate from index.ts so tests can build it with their own deps.
import cors from 'cors';
import express from 'express';
import type { AppDeps } from './deps.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { requestLogger } from './lib/request-logger.js';
import { createAdminRouter } from './modules/admin/router.js';
import { createAuthRouter } from './modules/auth/router.js';
import { createChatRouter } from './modules/chat/router.js';
import { createHealthRouter } from './modules/health/router.js';
import { createNursesRouter } from './modules/nurses/router.js';
import { createPaymentsRouter } from './modules/payments/router.js';
import { createQuestionsRouter } from './modules/questions/router.js';
import { createUsersRouter } from './modules/users/router.js';
import { createWalletsRouter } from './modules/wallets/router.js';

export function createApp(deps: AppDeps) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestLogger(deps.logger));
  app.use(cors({ origin: deps.config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.use(createHealthRouter(deps));
  app.use(createAuthRouter(deps));
  app.use(createUsersRouter(deps));
  app.use(createWalletsRouter(deps));
  app.use(createChatRouter(deps));
  app.use(createQuestionsRouter(deps));
  app.use(createNursesRouter(deps));
  app.use(createPaymentsRouter(deps));
  app.use(createAdminRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));

  return app;
}
