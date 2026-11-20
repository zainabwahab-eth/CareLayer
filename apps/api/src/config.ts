// Typed, validated environment config. Fails fast on startup with every invalid variable listed.
// Add each new env var here AND to .env.example. Variables for later tasks (auth, Paystack, LLM)
// are validated by the task that starts using them.
import { z } from 'zod';

const integerString = (name: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, `${name} must be a whole number`)
    .transform((v) => Number(v))
    .refine((v) => Number.isSafeInteger(v) && v > 0, `${name} must be a positive integer`);

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/** Empty strings in .env mean "not set". */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

/** Stellar account public key (G...). */
export const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

const booleanString = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** Comma-separated list of allowed browser origins (the two frontends). */
    CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required' })
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgresql:// URL'),
    /** Price of one nurse answer in kobo. ₦500 = 50000. */
    ANSWER_PRICE_KOBO: integerString('ANSWER_PRICE_KOBO').default(50000),
    /** Fixed demo rate: naira per 1 USDC. Up to 2 decimals, e.g. "1600" or "1550.50". */
    NGN_PER_USDC: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, 'NGN_PER_USDC must be a number with up to 2 decimals')
      .refine((v) => Number(v) > 0, 'NGN_PER_USDC must be greater than 0'),

    // ---- x402 on Stellar (testnet only: mainnet is out of scope) ----
    X402_NETWORK: z.preprocess(
      emptyToUndefined,
      z
        .literal('stellar:testnet', {
          error: 'X402_NETWORK must be stellar:testnet (mainnet is out of scope)',
        })
        .default('stellar:testnet'),
    ),
    X402_FACILITATOR_URL: z.preprocess(
      emptyToUndefined,
      z.url().default('https://channels.openzeppelin.com/x402/testnet'),
    ),
    /** OpenZeppelin Channels testnet key (https://channels.openzeppelin.com/testnet/gen). Secret. */
    X402_FACILITATOR_API_KEY: optionalString,
    /** Platform address that receives x402 payments (the treasury's public key). */
    X402_PAY_TO_ADDRESS: optionalString.refine(
      (v) => v === undefined || STELLAR_PUBLIC_KEY.test(v),
      'X402_PAY_TO_ADDRESS must be a Stellar public key (G..., 56 chars)',
    ),
    /** Z2 proof route GET /x402-test. Never enabled in production. */
    X402_TEST_ROUTE: booleanString,

    // ---- Auth (Z3) ----
    /** Signs 15-minute access tokens (HS256). At least 32 characters. Secret. */
    JWT_ACCESS_SECRET: z
      .string({ error: 'JWT_ACCESS_SECRET is required (see .env.example to generate one)' })
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    /** HMAC key for stored sign-in codes and refresh tokens. At least 32 characters. Secret. */
    AUTH_PEPPER: z
      .string({ error: 'AUTH_PEPPER is required (see .env.example to generate one)' })
      .min(32, 'AUTH_PEPPER must be at least 32 characters'),
    /** Google sign-in. Unset = POST /auth/google answers 503. */
    GOOGLE_CLIENT_ID: optionalString,
    /** Where sign-in codes go. Only "console" exists until Z11 picks a provider. */
    EMAIL_TRANSPORT: z.preprocess(emptyToUndefined, z.enum(['console']).default('console')),
    EMAIL_FROM: optionalString,
    /** Refresh cookie flags. Secure defaults to true in production. */
    AUTH_COOKIE_SECURE: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),
    AUTH_COOKIE_SAMESITE: z.preprocess(
      emptyToUndefined,
      z.enum(['lax', 'strict', 'none']).default('lax'),
    ),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && e.EMAIL_TRANSPORT === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message: 'console email would put sign-in codes in logs; set a real provider in production',
      });
    }
    const secure = e.AUTH_COOKIE_SECURE
      ? e.AUTH_COOKIE_SECURE === 'true'
      : e.NODE_ENV === 'production';
    if (e.AUTH_COOKIE_SAMESITE === 'none' && !secure) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SAMESITE'],
        message: 'SameSite=None requires AUTH_COOKIE_SECURE=true',
      });
    }
    if (!e.X402_TEST_ROUTE) return;
    if (e.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['X402_TEST_ROUTE'],
        message: 'X402_TEST_ROUTE must be off in production',
      });
    }
    if (!e.X402_FACILITATOR_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['X402_FACILITATOR_API_KEY'],
        message: 'required when X402_TEST_ROUTE is on',
      });
    }
    if (!e.X402_PAY_TO_ADDRESS) {
      ctx.addIssue({
        code: 'custom',
        path: ['X402_PAY_TO_ADDRESS'],
        message: 'required when X402_TEST_ROUTE is on',
      });
    }
  });

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type X402Config = {
  network: 'stellar:testnet';
  facilitatorUrl: string;
  facilitatorApiKey: string | undefined;
  payToAddress: string | undefined;
  testRouteEnabled: boolean;
};

export type AuthConfig = {
  jwtAccessSecret: string;
  pepper: string;
  googleClientId: string | undefined;
  emailTransport: 'console';
  emailFrom: string | undefined;
  cookie: { secure: boolean; sameSite: 'lax' | 'strict' | 'none' };
};

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  logLevel: LogLevel;
  databaseUrl: string;
  answerPriceKobo: number;
  /** Kept as a string so money maths never touches a float. See lib/money.ts. */
  ngnPerUsdc: string;
  x402: X402Config;
  auth: AuthConfig;
};

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    corsOrigins: e.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    answerPriceKobo: e.ANSWER_PRICE_KOBO,
    ngnPerUsdc: e.NGN_PER_USDC,
    x402: {
      network: e.X402_NETWORK,
      facilitatorUrl: e.X402_FACILITATOR_URL,
      facilitatorApiKey: e.X402_FACILITATOR_API_KEY,
      payToAddress: e.X402_PAY_TO_ADDRESS,
      testRouteEnabled: e.X402_TEST_ROUTE,
    },
    auth: {
      jwtAccessSecret: e.JWT_ACCESS_SECRET,
      pepper: e.AUTH_PEPPER,
      googleClientId: e.GOOGLE_CLIENT_ID,
      emailTransport: e.EMAIL_TRANSPORT,
      emailFrom: e.EMAIL_FROM,
      cookie: {
        secure: e.AUTH_COOKIE_SECURE
          ? e.AUTH_COOKIE_SECURE === 'true'
          : e.NODE_ENV === 'production',
        sameSite: e.AUTH_COOKIE_SAMESITE,
      },
    },
  };
}
