// MCP tools against a fake CareLayer API (in memory; no network). The API's own rules are tested in
// apps/api/test/agent-tokens.test.ts; here: the two-step flows, what Claude is told, and errors.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type {
  AnswerResponse,
  CreatedQuestion,
  DraftResponse,
  QuestionStatusResponse,
  WalletResponse,
} from '@carelayer/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CareLayerApiError, createCareLayerApi, type CareLayerApi } from '../src/api.js';
import { createMcpHttpServer } from '../src/http.js';
import { createServer } from '../src/server.js';

const DRAFT: DraftResponse = {
  kind: 'draft',
  draft: {
    originalText: 'im 30 weeks and my feet dey swell',
    cleanedText: 'I am 30 weeks pregnant and my feet are swelling.',
    assistantNotes: null,
    category: 'pregnancy',
    ageRange: 'age_25_34',
    pregnancyWeeks: 30,
  },
  draftToken: 'signed-draft',
  draftExpiresAt: '2026-11-22T20:00:00.000Z',
  offer: {
    price: { kobo: 50_000, usdc: '0.3125000' },
    isFree: false,
    freeAnswersRemaining: 0,
    suggestedCategory: 'pregnancy',
    exceedsSpendingLimit: false,
  },
};
const CREATED: CreatedQuestion = {
  kind: 'question',
  id: 'q1',
  status: 'open',
  category: 'pregnancy',
  price: { kobo: 50_000, usdc: '0.3125000' },
  isFree: false,
  nurseSelection: 'first_available',
  chosenUntil: null,
  claimsCloseAt: '2026-11-22T18:30:00.000Z',
  questionKey: null,
  createdAt: '2026-11-22T18:00:00.000Z',
};
const status = (s: QuestionStatusResponse['status']): QuestionStatusResponse => ({
  id: 'q1',
  status: s,
  category: 'pregnancy',
  claimsCloseAt: CREATED.claimsCloseAt,
  answeredAt: null,
  expiredAt: null,
});
const ANSWER: AnswerResponse = {
  answer: {
    questionId: 'q1',
    text: 'Some swelling is common at 30 weeks. Rest with your feet up.',
    nurse: { id: 'n1', displayName: 'Amaka Okafor', role: 'midwife', verified: true },
    recommendSeeSomeoneToday: true,
    answeredAt: '2026-11-22T18:10:00.000Z',
  },
  payment: {
    amount: { kobo: 50_000, usdc: '0.3125000' },
    stellarTxHash: 'ab'.repeat(32),
    paidFromTreasury: false,
  },
};

function fakeApi(overrides: Partial<CareLayerApi> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const base: CareLayerApi = {
    draft: async () => DRAFT,
    sendQuestion: async () => CREATED,
    status: async () => status('answered'),
    collect: async () => ANSWER,
    wallet: async (): Promise<WalletResponse> => ({
      stellarAddress: 'G'.padEnd(56, 'A'),
      status: 'active',
      balance: { kobo: 160_000, usdc: '1.0000000' },
      balanceSyncedAt: null,
      freeAnswersRemaining: 2,
    }),
  };
  const api = Object.fromEntries(
    Object.entries({ ...base, ...overrides }).map(([name, fn]) => [
      name,
      (...args: unknown[]) => {
        calls.push({ name, args });
        return (fn as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as CareLayerApi;
  return { api, calls };
}

async function connect(api: CareLayerApi) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(api);
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
    return { ...r, text: (r.content as { text: string }[])[0]?.text ?? '' };
  };
  return { client, call, close: () => Promise.all([client.close(), server.close()]) };
}

test('lists exactly the three CareLayer tools', async () => {
  const { client, close } = await connect(fakeApi().api);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'ask_health_worker',
    'get_answer',
    'get_balance',
  ]);
  await close();
});

test('ask_health_worker step 1: price and exactly what the nurse sees; nothing sent', async () => {
  const { api, calls } = fakeApi();
  const { call, close } = await connect(api);
  const r = await call('ask_health_worker', { question: DRAFT.draft.originalText });
  assert.equal(r.isError, undefined);
  assert.match(r.text, /Not sent yet/);
  assert.match(r.text, /₦500/);
  assert.match(r.text, /I am 30 weeks pregnant and my feet are swelling\./);
  assert.match(r.text, /Pregnancy: 30 weeks/);
  assert.match(r.text, /Age range: 25–34/);
  assert.match(r.text, /draftToken: "signed-draft"/);
  assert.deepEqual(
    calls.map((c) => c.name),
    ['draft'],
  );
  await close();
});

test('ask_health_worker step 2: sends only with confirm + draftToken, the signed draft and consent', async () => {
  const { api, calls } = fakeApi();
  const { call, close } = await connect(api);
  const missing = await call('ask_health_worker', { question: 'x', confirm: true });
  assert.equal(missing.isError, true);
  assert.equal(calls.length, 0);

  const r = await call('ask_health_worker', {
    question: DRAFT.draft.originalText,
    confirm: true,
    draftToken: 'signed-draft',
    femaleOnly: true,
  });
  assert.match(r.text, /Question id: q1/);
  assert.match(r.text, /get_answer/);
  const sent = calls.find((c) => c.name === 'sendQuestion')!.args[0] as Record<string, unknown>;
  assert.equal(sent.draftToken, 'signed-draft');
  assert.equal(sent.femaleOnly, true);
  assert.ok((sent.sharedFields as string[]).includes('cleaned_text'));
  assert.ok(!(sent.sharedFields as string[]).includes('original_text')); // her raw words stay private
  await close();
});

test('an emergency returns the free guidance and sends nothing', async () => {
  const { api, calls } = fakeApi({
    draft: async () => ({
      kind: 'emergency',
      message: 'Go to the nearest hospital now.',
      triggeredBy: ['heavy_bleeding'],
      contacts: [{ label: 'Emergency', number: '112', verified: false }],
      findHospitalUrl: 'https://maps.example/hospitals',
    }),
  });
  const { call, close } = await connect(api);
  const r = await call('ask_health_worker', { question: 'bleeding heavily at 6 months' });
  assert.match(r.text, /EMERGENCY/);
  assert.match(r.text, /Go to the nearest hospital now\./);
  assert.match(r.text, /112 \(number not yet verified\)/);
  assert.ok(!calls.some((c) => c.name === 'sendQuestion'));
  await close();
});

test('get_answer: waiting, then "ask her first", then the answer once she confirms', async () => {
  let current = status('open');
  let confirmedCalls = 0;
  const { api } = fakeApi({
    status: async () => current,
    collect: async (_id, confirm) => {
      if (!confirm) {
        throw new CareLayerApiError(409, 'PAYMENT_CONFIRMATION_REQUIRED', 'Confirm first', {
          price: { kobo: 50_000, usdc: '0.3125000' },
        });
      }
      confirmedCalls++;
      return ANSWER;
    },
  });
  const { call, close } = await connect(api);
  assert.match((await call('get_answer', { questionId: 'q1' })).text, /Still waiting/);
  current = status('answered');
  const ask = await call('get_answer', { questionId: 'q1' });
  assert.match(ask.text, /costs ₦500/);
  assert.match(ask.text, /confirmPayment: true/);
  assert.equal(confirmedCalls, 0);

  const r = await call('get_answer', { questionId: 'q1', confirmPayment: true });
  assert.match(r.text, /Amaka Okafor, verified midwife/);
  assert.match(r.text, /Some swelling is common/);
  assert.match(r.text, /TODAY/);
  assert.match(r.text, /stellar\.expert\/explorer\/testnet\/tx\/abab/);
  assert.equal(confirmedCalls, 1);
  await close();
});

test('get_answer: expired means not charged', async () => {
  const { api, calls } = fakeApi({ status: async () => status('expired') });
  const { call, close } = await connect(api);
  assert.match((await call('get_answer', { questionId: 'q1' })).text, /not charged/);
  assert.ok(!calls.some((c) => c.name === 'collect'));
  await close();
});

test('errors are explained in plain language (limit, balance, revoked connection)', async () => {
  const cases: [CareLayerApiError, RegExp][] = [
    [
      new CareLayerApiError(409, 'SPENDING_LIMIT_EXCEEDED', 'x', { spendingLimitKobo: 20_000 }),
      /Claude spending limit.*₦200/,
    ],
    [new CareLayerApiError(409, 'INSUFFICIENT_BALANCE', 'x'), /top up/],
    [new CareLayerApiError(401, 'UNAUTHENTICATED', 'x'), /not valid any more/],
  ];
  for (const [error, expected] of cases) {
    const { api } = fakeApi({
      collect: async () => {
        throw error;
      },
    });
    const { call, close } = await connect(api);
    const r = await call('get_answer', { questionId: 'q1', confirmPayment: true });
    assert.equal(r.isError, true);
    assert.match(r.text, expected);
    await close();
  }
});

test('get_balance shows naira and free answers left', async () => {
  const { call, close } = await connect(fakeApi().api);
  const r = await call('get_balance');
  assert.match(r.text, /₦1,600/);
  assert.match(r.text, /Free answers left: 2/);
  await close();
});

test('API client: sends the agent token, source "mcp" and maps API errors', async () => {
  const seen: { url: string; auth: string | null; body: unknown }[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    seen.push({
      url: String(input),
      auth: new Headers(init?.headers).get('authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (String(input).endsWith('/wallet')) {
      return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'nope' } }), {
        status: 403,
      });
    }
    return new Response(JSON.stringify(CREATED), { status: 201 });
  };
  const api = createCareLayerApi({
    baseUrl: 'https://api.test/',
    token: 'clat_abc',
    fetch: fetchStub,
  });
  await api.sendQuestion({
    question: 'q',
    draftToken: 't',
    sharedFields: ['cleaned_text', 'category'],
  });
  assert.equal(seen[0]!.url, 'https://api.test/questions');
  assert.equal(seen[0]!.auth, 'Bearer clat_abc');
  assert.equal((seen[0]!.body as { source: string }).source, 'mcp');
  await assert.rejects(
    api.wallet(),
    (e: unknown) => e instanceof CareLayerApiError && e.code === 'FORBIDDEN',
  );
});

test('HTTP mode: needs a clat_ bearer token, then serves the tools with THAT token', async () => {
  const tokens: (string | null)[] = [];
  const apiStub: typeof fetch = async (_input, init) => {
    tokens.push(new Headers(init?.headers).get('authorization'));
    return new Response(
      JSON.stringify({
        stellarAddress: 'G',
        status: 'active',
        balance: { kobo: 0, usdc: '0.0000000' },
        balanceSyncedAt: null,
        freeAnswersRemaining: 3,
      }),
      { status: 200 },
    );
  };
  const http = createMcpHttpServer({ apiUrl: 'https://api.test', fetch: apiStub });
  await new Promise<void>((r) => http.listen(0, r));
  const url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`);
  try {
    const noToken = await fetch(url, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(noToken.status, 401);

    const client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: 'Bearer clat_her_token' } },
      }),
    );
    const r = await client.callTool({ name: 'get_balance', arguments: {} });
    assert.match((r.content as { text: string }[])[0]!.text, /Free answers left: 3/);
    assert.deepEqual(tokens, ['Bearer clat_her_token']);
    await client.close();
  } finally {
    await new Promise((r) => http.close(r));
  }
});
