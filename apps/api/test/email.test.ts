// Resend transport (no network: fetch is faked) and email config.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/lib/logger.js';
import {
  codeEmailText,
  createEmailSender,
  createResendEmailSender,
  EmailSendError,
  RESEND_API_URL,
  type CodeEmail,
} from '../src/modules/auth/email.js';
import { testConfig } from './helpers/env.js';

const email: CodeEmail = {
  to: 'tolu@example.com',
  code: '123456',
  purpose: 'login',
  expiresInMinutes: 10,
};

function fakeFetch(status: number, body: unknown = { id: 'email_123' }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { fn, calls };
}

describe('Resend transport', () => {
  it('POSTs the code email to Resend with the key, sender, recipient, text and html', async () => {
    const { fn, calls } = fakeFetch(200);
    await createResendEmailSender(
      { apiKey: 're_test_key', from: 'CareLayer <codes@example.com>' },
      fn,
    ).sendCode(email);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(RESEND_API_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test_key');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f]{64}$/);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      from: 'CareLayer <codes@example.com>',
      to: ['tolu@example.com'],
      subject: 'Your CareLayer sign-in code',
    });
    expect(body.text).toContain('123456');
    expect(body.html).toContain('123456');
    expect(body.text).toContain('10 minutes');
  });

  it('uses the same idempotency key for a retried send, a different one for a new code', async () => {
    const { fn, calls } = fakeFetch(200);
    const sender = createResendEmailSender({ apiKey: 'k', from: 'a@example.com' }, fn);
    await sender.sendCode(email);
    await sender.sendCode(email);
    await sender.sendCode({ ...email, code: '654321' });
    const keys = calls.map((c) => (c.init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("throws EmailSendError with Resend's reason on a rejection, never the key or the code", async () => {
    const { fn } = fakeFetch(403, {
      name: 'validation_error',
      message: 'The example.com domain is not verified.',
    });
    const sender = createResendEmailSender({ apiKey: 're_secret_key', from: 'a@example.com' }, fn);
    const err = await sender.sendCode(email).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect((err as EmailSendError).status).toBe(403);
    expect((err as Error).message).toContain('not verified');
    expect((err as Error).message).not.toContain('re_secret_key');
    expect((err as Error).message).not.toContain('123456');
  });

  it('throws EmailSendError when the network fails or times out', async () => {
    const failing = (async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }) as typeof fetch;
    const err = await createResendEmailSender({ apiKey: 'k', from: 'a@example.com' }, failing)
      .sendCode(email)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect((err as Error).message).toContain('TimeoutError');
  });

  it('escapes HTML in the email template', () => {
    expect(codeEmailText({ ...email, code: '<b>1</b>' }).html).toContain('&lt;b&gt;1&lt;/b&gt;');
  });
});

describe('email config', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/x',
    NGN_PER_USDC: '1600',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    AUTH_PEPPER: 'y'.repeat(32),
  };

  it('resend needs an API key and a valid sender', () => {
    expect(() => loadConfig({ ...base, EMAIL_TRANSPORT: 'resend' })).toThrow(
      /EMAIL_API_KEY[\s\S]*EMAIL_FROM/,
    );
    expect(() =>
      loadConfig({
        ...base,
        EMAIL_TRANSPORT: 'resend',
        EMAIL_API_KEY: 'k',
        EMAIL_FROM: 'not an email',
      }),
    ).toThrow(/EMAIL_FROM/);
    for (const from of ['codes@example.com', 'CareLayer <codes@example.com>']) {
      expect(
        loadConfig({ ...base, EMAIL_TRANSPORT: 'resend', EMAIL_API_KEY: 'k', EMAIL_FROM: from })
          .auth,
      ).toMatchObject({
        emailTransport: 'resend',
        emailApiKey: 'k',
        emailFrom: from,
      });
    }
  });

  it('production accepts resend and still refuses console', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() => loadConfig(prod)).toThrow(/EMAIL_TRANSPORT/);
    expect(() =>
      loadConfig({
        ...prod,
        EMAIL_TRANSPORT: 'resend',
        EMAIL_API_KEY: 'k',
        EMAIL_FROM: 'codes@example.com',
      }),
    ).not.toThrow();
  });

  it('createEmailSender picks the transport', () => {
    const logger = createLogger('silent');
    const resend = createEmailSender(
      {
        ...testConfig().auth,
        emailTransport: 'resend',
        emailApiKey: 'k',
        emailFrom: 'a@example.com',
      },
      logger,
    );
    expect(resend).toBeDefined();
    expect(() =>
      createEmailSender({ ...testConfig().auth, emailTransport: 'resend' }, logger),
    ).toThrow();
  });
});
