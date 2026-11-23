import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn, testApi } from '../test/render-app';

/*
 * The mock follows apps/api's rules for cases and money (contract §9, §12), so the
 * screens behave the same in mock and HTTP mode.
 */

afterEach(() => vi.useRealTimers());

async function approved() {
  const api = testApi();
  await signIn(api, 'amaka@example.com');
  return api;
}

describe('mock cases (contract §9)', () => {
  it('only approved nurses see questions (403 NURSE_NOT_APPROVED)', async () => {
    const api = testApi();
    await signIn(api, 'funmi@example.com');
    await expect(api.cases.list('waiting')).rejects.toMatchObject({
      status: 403,
      code: 'NURSE_NOT_APPROVED',
    });
    // The dashboard works for any status.
    await expect(api.cases.dashboard()).resolves.toMatchObject({
      verificationStatus: 'pending_review',
      waitingCount: 0,
    });
  });

  it('lists waiting questions, chosen-for-you first', async () => {
    const api = await approved();
    const { items, nextCursor } = await api.cases.list('waiting');
    expect(items.length).toBeGreaterThan(0);
    expect(nextCursor).toBeNull();
    expect(items[0]!.chosenForYou).toBe(true);
    expect(items.every((q) => q.status === 'open')).toBe(true);
  });

  it('one claim at a time, with details.questionId', async () => {
    const api = await approved();
    const [first, second] = (await api.cases.list('waiting')).items;
    const claim = await api.cases.claim(first!.id);
    expect(Date.parse(claim.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    await expect(api.cases.claim(second!.id)).rejects.toMatchObject({
      status: 409,
      code: 'ACTIVE_CLAIM_EXISTS',
      details: { questionId: first!.id },
    });
    await expect(api.cases.current()).resolves.toMatchObject({ id: first!.id, status: 'claimed' });
    expect((await api.cases.list('active')).items).toHaveLength(1);
  });

  it('answer after the 10-minute lock is refused, and the question opens again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const api = await approved();
    const [q] = (await api.cases.list('waiting')).items;
    await api.cases.claim(q!.id);
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    await expect(api.cases.answer(q!.id, { text: 'Rest and drink water.' })).rejects.toMatchObject({
      status: 410,
      code: 'CLAIM_EXPIRED',
    });
    await expect(api.cases.get(q!.id)).resolves.toMatchObject({ status: 'open' });
  });

  it('answering completes the case; it is listed under completed', async () => {
    const api = await approved();
    const [q] = (await api.cases.list('waiting')).items;
    await api.cases.claim(q!.id);
    await expect(api.cases.answer(q!.id, { text: '  ' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const answer = await api.cases.answer(q!.id, {
      text: 'Go to a clinic today if it gets worse.',
      recommendSeeSomeoneToday: true,
    });
    expect(answer).toMatchObject({ questionId: q!.id, recommendSeeSomeoneToday: true });
    const done = await api.cases.list('completed');
    expect(done.items[0]).toMatchObject({ id: q!.id, status: 'answered' });
  });

  it('release returns it to waiting; releasing again is refused', async () => {
    const api = await approved();
    const [q] = (await api.cases.list('waiting')).items;
    await api.cases.claim(q!.id);
    await api.cases.release(q!.id);
    await expect(api.cases.get(q!.id)).resolves.toMatchObject({ status: 'open' });
    await expect(api.cases.release(q!.id)).rejects.toMatchObject({ code: 'NOT_CLAIM_OWNER' });
  });
});

describe('mock earnings and withdrawals (contract §12)', () => {
  it('earnings: 7 days Monday to Sunday, today marked, recent newest first', async () => {
    const api = await approved();
    const e = await api.earnings.get();
    expect(e.thisWeek.days.map((d) => d.weekday)).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ]);
    expect(e.thisWeek.days.filter((d) => d.isToday)).toHaveLength(1);
    expect(e.recent.length).toBeLessThanOrEqual(10);
    expect(e.available.kobo).toBeGreaterThan(0);
  });

  it('withdrawal needs a fresh code, then checks the minimum and the balance', async () => {
    const api = await approved();
    const body = {
      amountKobo: 50_000,
      destination: { kind: 'stellar' as const, address: `G${'A'.repeat(55)}` },
    };
    await expect(api.earnings.withdraw(body)).rejects.toMatchObject({
      status: 403,
      code: 'STEP_UP_REQUIRED',
    });
    await api.auth.requestCode({ email: 'amaka@example.com', purpose: 'step_up', app: 'nurses' });
    await expect(api.auth.stepUp({ code: '000000' })).rejects.toMatchObject({
      code: 'CODE_INVALID',
    });
    await api.auth.stepUp({ code: '123456' });

    await expect(api.earnings.withdraw({ ...body, amountKobo: 5_000 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      api.earnings.withdraw({ ...body, amountKobo: 1_000_000_000 }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });

    const w = await api.earnings.withdraw(body);
    expect(w.status).toBe('submitted');
    // One at a time.
    await expect(api.earnings.withdraw(body)).rejects.toMatchObject({ code: 'CONFLICT' });
    const history = await api.earnings.listWithdrawals();
    expect(history.items[0]!.id).toBe(w.id);
  });

  it('a step-up code goes to her own email only', async () => {
    const api = await approved();
    await expect(
      api.auth.requestCode({ email: 'someone@example.com', purpose: 'step_up', app: 'nurses' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('nurses may change appearance only', async () => {
    const api = await approved();
    await expect(api.me.updateSettings({ appearance: 'dark' })).resolves.toMatchObject({
      appearance: 'dark',
    });
    await expect(api.me.updateSettings({ quickExitTarget: 'news' } as never)).rejects.toMatchObject(
      { code: 'VALIDATION_FAILED' },
    );
  });
});
