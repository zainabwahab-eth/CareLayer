// Express app factory. Kept separate from index.ts so tests can build it with their own deps.
import { Keypair } from '@stellar/stellar-sdk';
import cors from 'cors';
import express from 'express';
import type { AppDeps } from './deps.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { requestLogger } from './lib/request-logger.js';
import { createAdminRouter } from './modules/admin/router.js';
import { createAdminService, type AdminService } from './modules/admin/service.js';
import { createCaseService, type CaseService } from './modules/nurses/cases.js';
import { createEarningsService, type EarningsService } from './modules/nurses/earnings.js';
import { createHorizonWithdrawalChain } from './modules/payments/withdrawal-chain.js';
import { createNurseProfileService, type NurseProfileService } from './modules/nurses/profile.js';
import { createEmailSender } from './modules/auth/email.js';
import { createAuthRouter } from './modules/auth/router.js';
import { createChatRouter } from './modules/chat/router.js';
import { createChatService, type ChatService } from './modules/chat/service.js';
import { loadRedFlags } from './modules/emergency/red-flags.js';
import { createAssistant, loadAssistantPrompt } from './modules/llm/assistant.js';
import { createOpenAiCompatibleClient } from './modules/llm/client.js';
import { createQuestionService, type QuestionService } from './modules/questions/service.js';
import { createHealthRouter } from './modules/health/router.js';
import { createNursesRouter } from './modules/nurses/router.js';
import { createPaymentsRouter } from './modules/payments/router.js';
import { createHorizonAnswerPaymentChain } from './modules/payments/chain.js';
import { createPayoutService, type PayoutService } from './modules/payments/payouts.js';
import { createAnswerPayer } from './modules/payments/x402-client.js';
import { createX402Server } from './modules/payments/x402.js';
import { createAnswerService, type AnswerService } from './modules/questions/answers.js';
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

/** Where answer payments go: X402_PAY_TO_ADDRESS, else the treasury's public key. */
export function answerPayTo(config: AppDeps['config']): string | undefined {
  if (config.x402.payToAddress) return config.x402.payToAddress;
  return config.wallet.treasurySecret
    ? Keypair.fromSecret(config.wallet.treasurySecret).publicKey()
    : undefined;
}

/** Z8: nurse payouts + answers (x402 pay on delivery, the API's own agent, feedback). */
export function buildAnswerServices(deps: AppDeps, wallets: WalletService) {
  const { config } = deps;
  const now = deps.clock ?? (() => new Date());
  const treasuryChain =
    deps.payoutChain ??
    (config.wallet.treasurySecret
      ? createHorizonTopupChain({
          horizonUrl: config.wallet.horizonUrl,
          treasurySecret: config.wallet.treasurySecret,
        })
      : undefined);
  const payouts = createPayoutService({
    db: deps.db,
    chain: treasuryChain,
    wallets,
    logger: deps.logger,
    now,
  });
  const walletChain =
    deps.walletChain ??
    (config.wallet.treasurySecret
      ? createHorizonWalletChain({
          horizonUrl: config.wallet.horizonUrl,
          treasurySecret: config.wallet.treasurySecret,
        })
      : undefined);
  const answers = createAnswerService({
    db: deps.db,
    config,
    payTo: answerPayTo(config),
    x402: deps.facilitator ? createX402Server(deps.facilitator, config.x402.network) : undefined,
    chain:
      deps.answerChain ?? createHorizonAnswerPaymentChain({ horizonUrl: config.wallet.horizonUrl }),
    walletChain,
    payer: deps.answerPayer ?? createAnswerPayer(config.x402.network),
    payouts,
    logger: deps.logger,
    now,
  });
  return { payouts, answers };
}

/** Z10: nurse earnings (N09) and withdrawals. */
export function buildEarningsService(deps: AppDeps, wallets: WalletService): EarningsService {
  const { config } = deps;
  return createEarningsService({
    db: deps.db,
    config,
    wallets,
    chain:
      deps.withdrawalChain ??
      (config.wallet.treasurySecret
        ? createHorizonWithdrawalChain({
            horizonUrl: config.wallet.horizonUrl,
            treasurySecret: config.wallet.treasurySecret,
          })
        : undefined),
    logger: deps.logger,
    now: deps.clock ?? (() => new Date()),
  });
}

export interface AppServices {
  wallets: WalletService;
  earnings: EarningsService;
  payouts: PayoutService;
  answers: AnswerService;
  topups: TopupService;
  chat: ChatService;
  questions: QuestionService;
  nurseProfiles: NurseProfileService;
  admin: AdminService;
  cases: CaseService;
}

/**
 * Chat + questions share the assistant and the red-flag list. Both files are read once here, at
 * startup: a missing prompt or a broken red-flag file stops the API instead of running without them.
 */
export function buildChatAndQuestionServices(deps: AppDeps) {
  const now = deps.clock ?? (() => new Date());
  const redFlags = loadRedFlags();
  const assistant = createAssistant({
    llm: deps.llm ?? createOpenAiCompatibleClient(deps.config.llm),
    systemPrompt: loadAssistantPrompt(),
    logger: deps.logger,
  });
  const shared = {
    db: deps.db,
    config: deps.config,
    assistant,
    redFlags,
    logger: deps.logger,
    now,
  };
  return {
    chat: createChatService(shared),
    questions: createQuestionService({
      ...shared,
      email: deps.emailSender ?? createEmailSender(deps.config.auth, deps.logger),
    }),
  };
}

/** Nurse onboarding + admin verification (Z9). */
export function buildNurseServices(deps: AppDeps) {
  const now = deps.clock ?? (() => new Date());
  const email = deps.emailSender ?? createEmailSender(deps.config.auth, deps.logger);
  const nurseProfiles = createNurseProfileService({ db: deps.db, logger: deps.logger, now });
  const cases = createCaseService({
    db: deps.db,
    email,
    logger: deps.logger,
    nurseAppUrl: deps.config.nurseAppUrl,
    webAppUrl: deps.config.webAppUrl,
    now,
  });
  const admin = createAdminService({
    db: deps.db,
    profiles: nurseProfiles,
    email,
    jwtAccessSecret: deps.config.auth.jwtAccessSecret,
    nurseAppUrl: deps.config.nurseAppUrl,
    logger: deps.logger,
    now,
  });
  return { nurseProfiles, cases, admin };
}

export function buildServices(deps: AppDeps): AppServices {
  const wallets = buildWalletService(deps);
  return {
    wallets,
    topups: buildTopupService(deps, wallets),
    ...buildAnswerServices(deps, wallets),
    earnings: buildEarningsService(deps, wallets),
    ...buildChatAndQuestionServices(deps),
    ...buildNurseServices(deps),
  };
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
  app.use(createChatRouter(deps, services.chat));
  app.use(createQuestionsRouter(deps, services.questions, services.answers));
  app.use(createNursesRouter(deps, services.nurseProfiles, services.cases, services.earnings));
  app.use(createPaymentsRouter(deps));
  app.use(createAdminRouter(deps, services.admin));

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));

  return app;
}
