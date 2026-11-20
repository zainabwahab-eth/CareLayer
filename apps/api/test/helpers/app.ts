import type { FacilitatorClient } from '@x402/core/server';
import { createApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import type { Db } from '../../src/db.js';
import { createLogger, type Logger } from '../../src/lib/logger.js';
import type { CodeEmail, EmailSender } from '../../src/modules/auth/email.js';
import type { GoogleIdentity, GoogleVerifier } from '../../src/modules/auth/google.js';
import type { TopupChain } from '../../src/modules/topups/chain.js';
import type { PaystackClient } from '../../src/modules/topups/paystack.js';
import type { WalletChain } from '../../src/modules/wallets/chain.js';
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
  });
}

/** Captures sign-in emails so tests can read the code. */
export function memoryEmailSender() {
  const sent: CodeEmail[] = [];
  return {
    sent,
    async sendCode(email: CodeEmail) {
      sent.push(email);
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
