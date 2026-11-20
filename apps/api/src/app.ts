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
import { createHorizonTopupChain } from './modules/topups/chain.js';
import { createPaystackClient } from './modules/topups/paystack.js';
import { createTopupsRouter } from './modules/topups/router.js';
import { createTopupService, type TopupService } from './modules/topups/service.js';
import { createUsersRouter } from './modules/users/router.js';
import { createHorizonWalletChain } from './modules/wallets/chain.js';
import { createWalletsRouter } from './modules/wallets/router.js';
import { createWalletService, type WalletService } from './modules/wallets/service.js';

/** One wallet service per app: shared by auth (create + activate at sign-up), /wallet and top-ups. */
export function buildWalletService(deps: AppDeps): WalletService {
  const { config } = deps;
  const chain =
    deps.walletChain ??
    (config.wallet.treasurySecret
      ? createHorizonWalletChain({
          horizonUrl: config.wallet.horizonUrl,
          treasurySecret: config.wallet.treasurySecret,
        })
      : undefined);
  return createWalletService({
    db: deps.db,
    config: config.wallet,
    ngnPerUsdc: config.ngnPerUsdc,
    chain,
    logger: deps.logger,
    now: deps.clock ?? (() => new Date()),
  });
}

export function buildTopupService(deps: AppDeps, wallets: WalletService): TopupService {
  const { config } = deps;
  return createTopupService({
    db: deps.db,
    paystack:
      deps.paystack ??
      (config.paystack.secretKey
        ? createPaystackClient({
            secretKey: config.paystack.secretKey,
            baseUrl: config.paystack.baseUrl,
          })
        : undefined),
    chain:
      deps.topupChain ??
      (config.wallet.treasurySecret
        ? createHorizonTopupChain({
            horizonUrl: config.wallet.horizonUrl,
            treasurySecret: config.wallet.treasurySecret,
          })
        : undefined),
    wallets,
    ngnPerUsdc: config.ngnPerUsdc,
    callbackUrl: config.paystack.callbackUrl,
    logger: deps.logger,
    now: deps.clock ?? (() => new Date()),
  });
}

export interface AppServices {
  wallets: WalletService;
  topups: TopupService;
}

export function buildServices(deps: AppDeps): AppServices {
  const wallets = buildWalletService(deps);
  return { wallets, topups: buildTopupService(deps, wallets) };
}

export function createApp(deps: AppDeps, services: AppServices = buildServices(deps)) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestLogger(deps.logger));
  app.use(cors({ origin: deps.config.corsOrigins, credentials: true }));
  // Paystack signs the RAW body: this route must not go through express.json().
  app.use('/webhooks/paystack', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));

  app.use(createHealthRouter(deps));
  app.use(createAuthRouter(deps, services.wallets));
  app.use(createUsersRouter(deps));
  app.use(createWalletsRouter(deps, services.wallets));
  app.use(createTopupsRouter(deps, services.topups));
  app.use(createChatRouter(deps));
  app.use(createQuestionsRouter(deps));
  app.use(createNursesRouter(deps));
  app.use(createPaymentsRouter(deps));
  app.use(createAdminRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));

  return app;
}
