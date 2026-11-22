// Z12 "done when", on Stellar testnet: the two-agent demo.
//   npm run two-agent:e2e -w @carelayer/api
// One woman asks one question from the web app (HTTP, her session) and one from Claude (the real
// apps/mcp server over stdio, her agent token). Both land in the same nurse queue; a nurse answers
// both; both answers are paid over x402 from her custodial wallet, and the nurse is paid 80% twice.
//
// Needs apps/api/.env (testnet:setup: treasury + facilitator key, migrated dev database) and an LLM:
// LLM_* from .env, or E2E_LLM_ENV_FILE=deploy/.env.production to borrow that file's LLM_* settings.
// Writes demo rows to the dev database (emails e2e-...@example.com).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildServices, createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { createLogger } from '../src/lib/logger.js';
import { createHorizonTopupChain } from '../src/modules/topups/chain.js';
import { createFacilitatorClient } from '../src/modules/payments/x402.js';
import { newCustodialWallet } from '../src/modules/wallets/crypto.js';
import type { EmailSender } from '../src/modules/auth/email.js';

const explorer = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const log = (s: string) => console.log(`[two-agent] ${s}`);

// Optional: borrow LLM_* from another env file (values are never printed).
if (process.env.E2E_LLM_ENV_FILE) {
  const text = readFileSync(resolve(process.cwd(), process.env.E2E_LLM_ENV_FILE), 'utf8');
  for (const key of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL']) {
    const m = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
    if (m?.[1]) process.env[key] = m[1].trim();
  }
}

const config = loadConfig();
const db = createDb(config.databaseUrl);
const codes = new Map<string, string>();
const emailSender: EmailSender = {
  async sendCode(e) {
    codes.set(e.to, e.code);
  },
  async sendNurseAlert() {},
  async sendNurseReview() {},
  async sendAnswerReady() {},
};
const deps = {
  config,
  db,
  logger: createLogger('warn'),
  facilitator: createFacilitatorClient(config.x402),
  emailSender,
};
const services = buildServices(deps);
const server = createApp(deps, services).listen(0);
await new Promise<void>((r) => server.once('listening', () => r()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function http(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function signIn(
  email: string,
  app: 'women' | 'nurses',
  purpose: 'signup' | 'login',
  name?: string,
) {
  await http('POST', '/auth/code/request', undefined, { email, purpose, app, name });
  const r = await http('POST', '/auth/code/verify', undefined, {
    email,
    code: codes.get(email),
    purpose,
    app,
    name,
  });
  return { token: r.accessToken as string, userId: r.user.id as string };
}

/** Sign-up already starts activation in the background: wait until the wallet is on chain. */
async function activeWallet(userId: string) {
  for (let i = 0; i < 40; i++) {
    const outcome = await services.wallets.activate(userId);
    if (outcome === 'activated' || outcome === 'already_active') return;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error('wallet activation did not finish');
}

let mcp: Client | undefined;
try {
  const tag = randomUUID().slice(0, 8);

  // 1. Her account (no free answers left: both answers are paid), a funded wallet, an agent token.
  const her = await signIn(`e2e-two-agent-${tag}@example.com`, 'women', 'signup', 'Tolu');
  await db.user.update({ where: { id: her.userId }, data: { freeAnswersUsed: 3 } });
  await activeWallet(her.userId);
  const wallet = await services.wallets.ensureWallet(her.userId);
  const fund = await createHorizonTopupChain({
    horizonUrl: config.wallet.horizonUrl,
    treasurySecret: config.wallet.treasurySecret!,
  }).sendUsdc(wallet.stellarPublicKey, 10_000_000n, `e2e2-${tag}`);
  log(`her wallet funded with 1 USDC: ${explorer(fund.txHash)}`);
  const agent = await http('POST', '/auth/agent-tokens', her.token, { label: 'Claude (e2e)' });

  // 2. A verified midwife who answers.
  const nurseEmail = `e2e-two-agent-nurse-${tag}@example.com`;
  const nurseUser = await db.user.create({
    data: {
      role: 'NURSE',
      email: nurseEmail,
      displayName: 'E2E Midwife',
      wallet: { create: newCustodialWallet(config.wallet.encryptionKey) },
      nurseProfile: {
        create: {
          fullName: 'E2E Midwife',
          role: 'MIDWIFE',
          gender: 'FEMALE',
          languages: ['ENGLISH'],
          licenceNumber: `E2E2-${tag}`,
          verificationStatus: 'APPROVED',
          available: true,
          topics: { create: [{ topicSlug: 'periods' }, { topicSlug: 'pregnancy' }] },
        },
      },
    },
  });
  await activeWallet(nurseUser.id);
  const nurse = await signIn(nurseEmail, 'nurses', 'login');

  // 3. Claude: the real MCP server (apps/mcp) over stdio with her agent token.
  mcp = new Client({ name: 'two-agent-e2e', version: '1' });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        resolve(import.meta.dirname, '../../../node_modules/tsx/dist/cli.mjs'),
        'src/index.ts',
      ],
      cwd: resolve(import.meta.dirname, '../../mcp'),
      env: { ...process.env, CARELAYER_API_URL: base, CARELAYER_AGENT_TOKEN: agent.token },
      stderr: 'ignore',
    }),
  );
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp!.callTool({ name, arguments: args });
    const content = r.content as { text: string }[];
    return { text: content[0]?.text ?? '', data: r.structuredContent as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const claudeQuestion = 'my period is two weeks late, could I be pregnant? I am 24';
  const step1 = await tool('ask_health_worker', { question: claudeQuestion });
  log(`Claude step 1 (draft shown to her):\n${step1.text.split('\n').slice(0, 6).join('\n')}`);
  const step2 = await tool('ask_health_worker', {
    question: claudeQuestion,
    confirm: true,
    draftToken: step1.data.draftToken,
  });
  const claudeId = step2.data.id as string;
  log(`Claude sent question ${claudeId}`);

  // 4. The web app: draft (W07) then send, with her session.
  const webQuestion = 'is it safe to have sex when I am 7 months pregnant';
  const draft = await http('POST', '/chat/draft', her.token, {
    messages: [{ role: 'user', text: webQuestion }],
  });
  const web = await http('POST', '/questions', her.token, {
    originalText: webQuestion,
    source: 'web',
    consent: { sharedFields: ['cleaned_text', 'category'], consentVersion: 'consent-v1' },
    draftToken: draft.draftToken,
  });
  log(`web app sent question ${web.id}`);

  // 5. Same nurse queue: she sees both, claims and answers both.
  const waiting = await http('GET', '/nurse/questions?tab=waiting', nurse.token);
  const ids = (waiting.items as { id: string }[]).map((i) => i.id);
  if (!ids.includes(claudeId) || !ids.includes(web.id as string)) {
    throw new Error('both questions should be in the nurse queue');
  }
  log('both questions are in the same nurse queue');
  for (const id of [claudeId, web.id as string]) {
    await http('POST', `/nurse/questions/${id}/claim`, nurse.token);
    await http('POST', `/nurse/questions/${id}/answer`, nurse.token, {
      text: 'General guidance from the e2e midwife. See a health worker if you are worried.',
    });
  }

  // 6. Both collected and paid over x402 from her wallet.
  const paidWeb = await http('POST', `/me/questions/${web.id}/collect`, her.token);
  log(`web answer paid over x402: ${explorer(paidWeb.payment.stellarTxHash)}`);
  const ask = await tool('get_answer', { questionId: claudeId });
  log(`Claude get_answer (asks her first): ${ask.text.split('.')[0]}.`);
  const paidClaude = await tool('get_answer', { questionId: claudeId, confirmPayment: true });
  log(`Claude answer paid over x402: ${explorer(paidClaude.data.payment.stellarTxHash)}`);

  // 7. The nurse's 80%, twice.
  for (const questionId of [web.id as string, claudeId]) {
    const payment = await db.payment.findUniqueOrThrow({
      where: { questionId },
      include: { payout: true },
    });
    let payout = payment.payout!;
    for (let i = 0; i < 30 && payout.status !== 'CONFIRMED'; i++) {
      payout = await services.payouts.send(payout.id);
      if (payout.status !== 'CONFIRMED') await new Promise((r) => setTimeout(r, 2_000));
    }
    log(
      `nurse payout for ${questionId === claudeId ? 'Claude' : 'web'} question: ${explorer(payout.stellarTxHash!)}`,
    );
  }
  log('done: two agents, one queue, both paid via x402');
} finally {
  await mcp?.close().catch(() => undefined);
  server.close();
  await db.$disconnect();
}
