import type { FacilitatorClient } from '@x402/core/server';
import { createApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import type { Db } from '../../src/db.js';
import { createLogger, type Logger } from '../../src/lib/logger.js';
import type {
  CodeEmail,
  EmailSender,
  NurseAlertEmail,
  NurseReviewEmail,
  AnswerReadyEmail,
} from '../../src/modules/auth/email.js';
import {
  LlmUnavailableError,
  type LlmClient,
  type LlmRequest,
} from '../../src/modules/llm/client.js';
import type { GoogleIdentity, GoogleVerifier } from '../../src/modules/auth/google.js';
import type { TopupChain } from '../../src/modules/topups/chain.js';
import type { PaystackClient } from '../../src/modules/topups/paystack.js';
import type { WalletChain } from '../../src/modules/wallets/chain.js';
import type { AnswerPaymentChain } from '../../src/modules/payments/chain.js';
import type { AnswerPayer } from '../../src/modules/payments/x402-client.js';
import { testConfig } from './env.js';

export function buildTestApp(
  db: Db,
  opts: {
    config?: Partial<Config>;
    logger?: Logger;
    facilitator?: FacilitatorClient;
    clock?: () => Date;
    emailSender?: EmailSender;
    googleVerifier?: GoogleVerifier;
    walletChain?: WalletChain;
    paystack?: PaystackClient;
    topupChain?: TopupChain;
    payoutChain?: TopupChain;
    answerChain?: AnswerPaymentChain;
    answerPayer?: AnswerPayer;
    llm?: LlmClient;
  } = {},
) {
  return createApp({
    config: testConfig(opts.config),
    db,
    logger: opts.logger ?? createLogger('silent'),
    facilitator: opts.facilitator,
    clock: opts.clock,
    emailSender: opts.emailSender ?? memoryEmailSender(),
    googleVerifier: opts.googleVerifier,
    walletChain: opts.walletChain,
    paystack: opts.paystack,
    topupChain: opts.topupChain,
    payoutChain: opts.payoutChain,
    // Never Horizon in gate tests: a chain that finds nothing unless the test passes one.
    answerChain: opts.answerChain ?? { findTransfer: async () => null },
    answerPayer: opts.answerPayer,
    // Never the real provider in gate tests: a fake that fails like an unconfigured key.
    llm: opts.llm ?? unconfiguredLlm(),
  });
}

/** An LLM that is never reachable (chat answers 503). Tests that need replies pass fakeLlm(). */
export function unconfiguredLlm(): LlmClient {
  return {
    async complete() {
      throw new LlmUnavailableError('not_configured', 'no LLM in this test');
    },
  };
}

/**
 * Scripted LLM. Each call takes the next reply: a JSON-able object, a raw string, or an Error to
 * throw. `calls` records every request (to assert on prompts and history).
 */
export function fakeLlm(...replies: (object | string | Error)[]) {
  const calls: LlmRequest[] = [];
  const client: LlmClient & { calls: LlmRequest[]; queue: typeof replies } = {
    calls,
    queue: replies,
    async complete(req) {
      calls.push(req);
      const next = replies.shift();
      if (next === undefined) throw new Error('fakeLlm: no scripted reply left');
      if (next instanceof Error) throw next;
      return {
        content: typeof next === 'string' ? next : JSON.stringify(next),
        model: 'fake-model',
        latencyMs: 1,
        promptTokens: 10,
        completionTokens: 10,
      };
    },
  };
  return client;
}

/** Captures sign-in emails and nurse alerts so tests can read them. */
export function memoryEmailSender() {
  const sent: CodeEmail[] = [];
  const alerts: NurseAlertEmail[] = [];
  const reviews: NurseReviewEmail[] = [];
  const answersReady: AnswerReadyEmail[] = [];
  return {
    sent,
    alerts,
    reviews,
    answersReady,
    async sendCode(email: CodeEmail) {
      sent.push(email);
    },
    async sendNurseAlert(email: NurseAlertEmail) {
      alerts.push(email);
    },
    async sendNurseReview(email: NurseReviewEmail) {
      reviews.push(email);
    },
    async sendAnswerReady(email: AnswerReadyEmail) {
      answersReady.push(email);
    },
    /** The latest code sent to this address. */
    lastCode(to: string): string {
      const email = [...sent].reverse().find((e) => e.to === to);
      if (!email) throw new Error(`no code sent to ${to}`);
      return email.code;
    },
  };
}

/** A clock tests can move forward. */
export function fakeClock(start = new Date('2026-11-20T09:00:00.000Z')) {
  let now = start.getTime();
  const clock = () => new Date(now);
  clock.advance = (ms: number) => {
    now += ms;
  };
  return clock;
}

/** Google verifier that accepts tokens of the form "valid:<sub>:<email>[:unverified]". */
export function fakeGoogleVerifier(): GoogleVerifier {
  return {
    async verify(idToken: string): Promise<GoogleIdentity | null> {
      const [kind, sub, email, flag] = idToken.split(':');
      if (kind !== 'valid' || !sub || !email) return null;
      return { sub, email, emailVerified: flag !== 'unverified', name: 'Google Name' };
    },
  };
}

/** A Db stand-in whose queries fail like a dead Postgres. Only $queryRaw is used by /health. */
export function deadDb(mode: 'reject' | 'hang' = 'reject'): Db {
  return {
    $queryRaw: () =>
      mode === 'reject'
        ? Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432'))
        : new Promise(() => {}),
  } as unknown as Db;
}
