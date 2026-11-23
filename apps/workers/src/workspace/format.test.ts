import type { NurseProfile, NurseQuestionView } from '@carelayer/shared';
import { describe, expect, it } from 'vitest';
import { activeSection } from '../layouts/workspace-nav';
import {
  ANSWER_SHARE_KOBO,
  contextLine,
  formatCountdown,
  parseNaira,
  waitingLabel,
} from './format';
import { buildUpdates } from './updates';

describe('workspace format helpers', () => {
  it('the nurse share is 80% of the default ₦500', () => {
    expect(ANSWER_SHARE_KOBO).toBe(40_000);
  });

  it('countdowns never go negative and round up to the second', () => {
    expect(formatCountdown(522_000)).toBe('08:42');
    expect(formatCountdown(1)).toBe('00:01');
    expect(formatCountdown(-5_000)).toBe('00:00');
  });

  it('parses naira amounts to kobo', () => {
    expect(parseNaira('1,000')).toBe(100_000);
    expect(parseNaira('₦250.50')).toBe(25_050);
    expect(parseNaira('12.345')).toBeNull();
    expect(parseNaira('abc')).toBeNull();
  });

  it('context and waiting labels', () => {
    expect(contextLine({ ageRange: 'age_25_34', pregnancyWeeks: 30 })).toBe('Age 25–34, 30 weeks');
    expect(contextLine({ ageRange: null, pregnancyWeeks: null })).toBe('');
    const now = Date.parse('2026-11-23T10:10:00Z');
    expect(waitingLabel('2026-11-23T10:06:00Z', now)).toBe('Waiting 4 min');
    expect(waitingLabel('2026-11-23T10:09:30Z', now)).toBe('Waiting under a minute');
  });

  it('nav section follows the URL', () => {
    expect(activeSection('/cases', '')).toBe('available');
    expect(activeSection('/cases', '?tab=active')).toBe('mine');
    expect(activeSection('/earnings/withdraw', '')).toBe('earnings');
    expect(activeSection('/today', '')).toBe('today');
  });
});

describe('buildUpdates', () => {
  const profile = {
    userId: 'n1',
    available: true,
    topics: ['pregnancy'],
    verificationStatus: 'approved',
  } as unknown as NurseProfile;
  const q = (patch: Partial<NurseQuestionView>): NurseQuestionView =>
    ({
      id: 'q1',
      status: 'open',
      category: 'pregnancy',
      chosenForYou: false,
      createdAt: '2026-11-23T10:00:00Z',
      ...patch,
    }) as NurseQuestionView;

  it('chosen-for-you and deadlines come first; other topics give no alert', () => {
    const now = Date.parse('2026-11-23T10:05:00Z');
    const updates = buildUpdates({
      profile,
      now,
      waiting: [
        q({ id: 'a' }),
        q({ id: 'b', chosenForYou: true }),
        q({ id: 'c', category: 'periods' }),
      ],
    });
    expect(updates[0]!.kind).toBe('chosen');
    expect(updates.filter((u) => u.kind === 'new_question').map((u) => u.id)).toEqual(['new:a']);
    expect(updates.some((u) => u.id === 'new:c')).toBe(false);
  });

  it('no new-question alerts while unavailable, and says so', () => {
    const updates = buildUpdates({
      profile: { ...profile, available: false },
      now: Date.now(),
      waiting: [q({ id: 'a' })],
    });
    expect(updates.some((u) => u.kind === 'new_question')).toBe(false);
    expect(updates.some((u) => u.id === 'account:unavailable')).toBe(true);
  });
});
