// Z2 unit tests (no network). A fake facilitator records every call, so we can prove the guard
// stops the request before x402 asks for payment or talks to the facilitator.
import { Keypair } from '@stellar/stellar-sdk';
import type { FacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { errorHandler, notFoundHandler, AppError } from '../src/lib/errors.js';
import { createLogger } from '../src/lib/logger.js';
import { payOnDeliveryGuard } from '../src/modules/payments/guard.js';
import {
  createX402Server,
  USDC_TESTNET_ADDRESS,
  usdcPrice,
  X402_TEST_PRICE_STROOPS,
} from '../src/modules/payments/x402.js';
import { buildTestApp, deadDb } from './helpers/app.js';

const PAY_TO = Keypair.random().publicKey();

function fakeFacilitator() {
  return {
    verify: vi.fn<FacilitatorClient['verify']>(async () => ({
      isValid: false,
      invalidReason: 'fake',
    })),
    settle: vi.fn<FacilitatorClient['settle']>(async () => ({
      success: false,
      transaction: '',
      network: 'stellar:testnet',
    })),
    getSupported: vi.fn<FacilitatorClient['getSupported']>(async () => ({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }],
      extensions: [],
      signers: {},
    })),
  };
}

function x402App(facilitator: FacilitatorClient) {
  return buildTestApp(deadDb(), {
    facilitator,
    config: {
      x402: {
        network: 'stellar:testnet',
        facilitatorUrl: 'https://facilitator.invalid',
        facilitatorApiKey: 'test',
        payToAddress: PAY_TO,
        testRouteEnabled: true,
      },
    },
  });
}

/** PAYMENT-REQUIRED is base64-encoded JSON (x402 v2). */
function decodePaymentRequired(header: string | undefined) {
  expect(header, 'PAYMENT-REQUIRED header').toBeTruthy();
  return JSON.parse(Buffer.from(header!, 'base64').toString('utf8'));
}

describe('pay-on-delivery guard (runs before x402)', () => {
  it('returns 409 QUESTION_NOT_ANSWERED and requests no payment when the condition is false', async () => {
    const facilitator = fakeFacilitator();
    const res = await request(x402App(facilitator)).get('/x402-test?ready=false');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUESTION_NOT_ANSWERED');
    expect(res.headers['payment-required']).toBeUndefined();
    expect(res.status).not.toBe(402);
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it('lets the request through to x402 when the condition is true (402 with requirements)', async () => {
    const facilitator = fakeFacilitator();
    const res = await request(x402App(facilitator)).get('/x402-test');

    expect(res.status).toBe(402);
    const required = decodePaymentRequired(res.headers['payment-required']);
    expect(required.x402Version).toBe(2);
    expect(required.accepts).toHaveLength(1);
    expect(required.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'stellar:testnet',
      payTo: PAY_TO,
      asset: USDC_TESTNET_ADDRESS,
      amount: '100000', // 0.01 USDC in stroops
    });
    // No payment was attached, so nothing was verified or settled.
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it('passes guard errors (e.g. a DB failure) to the central handler instead of charging', async () => {
    const app = express();
    app.use(
      '/thing',
      payOnDeliveryGuard(
        () => {
          throw new Error('db down');
        },
        () => new AppError(409, 'QUESTION_NOT_ANSWERED', 'x'),
      ),
    );
    app.get('/thing', (_req, res) => void res.json({ paid: true }));
    app.use(errorHandler(createLogger('silent')));
    const res = await request(app).get('/thing');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });
});

describe('x402 route configuration', () => {
  it('the test route is off by default (404)', async () => {
    const res = await request(buildTestApp(deadDb())).get('/x402-test');
    expect(res.status).toBe(404);
  });

  it('price is 0.01 USDC, expressed in stroops, never a float', () => {
    expect(X402_TEST_PRICE_STROOPS).toBe(100_000n);
    expect(usdcPrice(3_125_000n)).toEqual({ asset: USDC_TESTNET_ADDRESS, amount: '3125000' });
    expect(() => usdcPrice(0n)).toThrow();
  });

  it('price and payTo can be set per request (answers the Z2 question for Z8)', async () => {
    // Two "questions" with different prices and different receivers, resolved from the path.
    const receivers: Record<string, string> = {
      q1: Keypair.random().publicKey(),
      q2: Keypair.random().publicKey(),
    };
    const prices: Record<string, bigint> = { q1: 3_125_000n, q2: 1_000_000n };
    const idOf = (path: string) => path.split('/').pop()!;

    const app = express();
    app.use(
      paymentMiddleware(
        {
          'GET /answers/*': {
            accepts: {
              scheme: 'exact',
              network: 'stellar:testnet',
              payTo: (ctx) => receivers[idOf(ctx.path)]!,
              price: (ctx) => usdcPrice(prices[idOf(ctx.path)]!),
            },
          },
        },
        createX402Server(fakeFacilitator(), 'stellar:testnet'),
      ),
    );
    app.get('/answers/:id', (_req, res) => void res.json({ ok: true }));
    app.use(notFoundHandler);

    for (const id of ['q1', 'q2']) {
      const res = await request(app).get(`/answers/${id}`);
      expect(res.status).toBe(402);
      const [accept] = decodePaymentRequired(res.headers['payment-required']).accepts;
      expect(accept.payTo).toBe(receivers[id]);
      expect(accept.amount).toBe(prices[id]!.toString());
    }
  });
});

describe('x402 env validation', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/x',
    NGN_PER_USDC: '1600',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    AUTH_PEPPER: 'y'.repeat(32),
  };

  it('defaults to the OpenZeppelin testnet facilitator with the test route off', () => {
    expect(loadConfig(base).x402).toEqual({
      network: 'stellar:testnet',
      facilitatorUrl: 'https://channels.openzeppelin.com/x402/testnet',
      facilitatorApiKey: undefined,
      payToAddress: undefined,
      testRouteEnabled: false,
    });
  });

  it('requires the API key and payTo address when the test route is on', () => {
    expect(() => loadConfig({ ...base, X402_TEST_ROUTE: 'true' })).toThrow(
      /X402_FACILITATOR_API_KEY.*\n.*X402_PAY_TO_ADDRESS/s,
    );
  });

  it('refuses the test route in production, mainnet, and malformed addresses', () => {
    const on = {
      ...base,
      X402_TEST_ROUTE: 'true',
      X402_FACILITATOR_API_KEY: 'k',
      X402_PAY_TO_ADDRESS: PAY_TO,
    };
    expect(loadConfig(on).x402.testRouteEnabled).toBe(true);
    expect(() => loadConfig({ ...on, NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, X402_NETWORK: 'stellar:pubnet' })).toThrow(/mainnet/);
    expect(() => loadConfig({ ...base, X402_PAY_TO_ADDRESS: 'GABC' })).toThrow(
      /X402_PAY_TO_ADDRESS/,
    );
  });

  it('treats empty .env values as unset (and falls back to defaults)', () => {
    const x402 = loadConfig({
      ...base,
      X402_FACILITATOR_API_KEY: '',
      X402_PAY_TO_ADDRESS: '',
      X402_FACILITATOR_URL: '',
      X402_NETWORK: '',
      X402_TEST_ROUTE: '',
    }).x402;
    expect(x402).toEqual({
      network: 'stellar:testnet',
      facilitatorUrl: 'https://channels.openzeppelin.com/x402/testnet',
      facilitatorApiKey: undefined,
      payToAddress: undefined,
      testRouteEnabled: false,
    });
  });

  it('accepts the shipped .env.example once its two required secrets are filled', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    const env = Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((l) => /^[A-Z0-9_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    // Shipped empty on purpose (secrets): startup must fail and name them.
    expect(() => loadConfig(env)).toThrow(/JWT_ACCESS_SECRET[\s\S]*AUTH_PEPPER/);
    expect(() =>
      loadConfig({ ...env, JWT_ACCESS_SECRET: 'a'.repeat(48), AUTH_PEPPER: 'b'.repeat(48) }),
    ).not.toThrow();
  });
});
