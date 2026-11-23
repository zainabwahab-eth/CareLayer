import type {
  EarningsResponse,
  NurseDashboard,
  NurseProfile,
  NurseQuestionView,
} from '@carelayer/shared';
import type { IconName } from '@web/components/Icon/icons';
import { categoryLabel } from '@web/utils/categories';
import { formatNaira } from '@web/utils/money';
import { useCallback, useMemo, useState } from 'react';
import { casePath, paths } from '../routes/paths';
import { formatCountdown, msUntil } from './format';
import { useNurseQuery } from './hooks';

/*
 * The notification centre (Updates). apps/api has no notification feed for
 * nurses (docs/QUESTIONS.md Q6), so updates are worked out from real data:
 * GET /nurse/dashboard, GET /nurse/questions?tab=waiting and GET /nurse/earnings.
 * Nothing here is made up: each update points at the record it comes from.
 *
 * Read/unread lives on this device only, as a list of update ids (never any
 * question text), per nurse. A server-side read state would need an endpoint.
 */

export type UpdateKind =
  'chosen' | 'new_question' | 'deadline' | 'earning' | 'withdrawal' | 'account';

export interface WorkspaceUpdate {
  id: string;
  kind: UpdateKind;
  icon: IconName;
  title: string;
  detail: string;
  to: string;
  /** For ordering, newest first. */
  at: string;
  /** Needs her attention now (shown first, never auto-read). */
  urgent?: boolean;
}

export function buildUpdates(input: {
  profile: NurseProfile;
  dashboard?: NurseDashboard;
  waiting?: NurseQuestionView[];
  earnings?: EarningsResponse;
  now: number;
}): WorkspaceUpdate[] {
  const { profile, dashboard, waiting = [], earnings, now } = input;
  const updates: WorkspaceUpdate[] = [];

  const claim = dashboard?.activeClaim;
  if (claim?.claimExpiresAt) {
    const left = msUntil(claim.claimExpiresAt, now);
    if (left > 0) {
      updates.push({
        id: `deadline:${claim.id}:${claim.claimExpiresAt}`,
        kind: 'deadline',
        icon: 'clock',
        title: `${formatCountdown(left)} left to answer`,
        detail: `Your ${categoryLabel(claim.category).toLowerCase()} question is waiting for your answer.`,
        to: casePath(claim.id),
        at: new Date(now).toISOString(),
        urgent: true,
      });
    }
  }

  for (const q of waiting) {
    if (q.chosenForYou) {
      updates.push({
        id: `chosen:${q.id}`,
        kind: 'chosen',
        icon: 'heart',
        title: 'A woman chose you to answer',
        detail: `${categoryLabel(q.category)}. Only you can claim it for the first 10 minutes.`,
        to: casePath(q.id),
        at: q.createdAt,
        urgent: true,
      });
    } else if (profile.available && profile.topics.includes(q.category)) {
      updates.push({
        id: `new:${q.id}`,
        kind: 'new_question',
        icon: 'chat',
        title: `New ${categoryLabel(q.category).toLowerCase()} question`,
        detail: 'In one of your topics. Claims close 30 minutes after she asks.',
        to: casePath(q.id),
        at: q.createdAt,
      });
    }
  }

  for (const entry of earnings?.recent ?? []) {
    if (entry.kind === 'earning') {
      updates.push(
        entry.status === 'confirmed'
          ? {
              id: `earning:${entry.id}`,
              kind: 'earning',
              icon: 'wallet',
              title: `You earned ${formatNaira(entry.amount)}`,
              detail: `“${entry.title}” was opened and paid to your wallet.`,
              to: paths.earnings,
              at: entry.earnedAt,
            }
          : {
              id: `earning-pending:${entry.id}`,
              kind: 'earning',
              icon: 'clock',
              title: 'Payment on its way',
              detail: `${formatNaira(entry.amount)} for “${entry.title}” is being sent to your wallet.`,
              to: paths.earnings,
              at: entry.earnedAt,
            },
      );
    } else {
      const done = entry.status === 'confirmed';
      updates.push({
        id: `withdrawal:${entry.id}:${entry.status}`,
        kind: 'withdrawal',
        icon: 'wallet',
        title: done ? 'Withdrawal sent' : 'Withdrawal processing',
        detail: `${formatNaira(-entry.amount.kobo)} to your Stellar wallet${done ? ' has landed' : ' is on its way'}.`,
        to: paths.withdrawals,
        at: entry.createdAt,
      });
    }
  }

  if (profile.verificationStatus === 'approved') {
    updates.push({
      id: 'account:approved',
      kind: 'account',
      icon: 'shield',
      title: 'Your licence is verified',
      detail: 'You can claim and answer questions, and you are paid for every answer opened.',
      to: paths.profile,
      at: new Date(0).toISOString(),
    });
  }
  if (!profile.available) {
    updates.push({
      id: 'account:unavailable',
      kind: 'account',
      icon: 'bell',
      title: 'You are set to unavailable',
      detail: 'You will not get new question alerts until you turn availability back on.',
      to: paths.today,
      at: new Date(now).toISOString(),
    });
  }

  return updates.sort(
    (a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)) || b.at.localeCompare(a.at),
  );
}

const READ_KEY = 'carelayer.hw.updates-read';
/** Keep the stored list small. */
const MAX_READ_IDS = 200;

function readIds(userId: string): string[] {
  try {
    const raw = window.localStorage.getItem(`${READ_KEY}.${userId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeIds(userId: string, ids: string[]) {
  try {
    window.localStorage.setItem(`${READ_KEY}.${userId}`, JSON.stringify(ids.slice(-MAX_READ_IDS)));
  } catch {
    // Storage unavailable (private mode): read state lasts for this page only.
  }
}

/** Which updates she has read, on this device, per nurse. */
export function useReadState(userId: string) {
  const [read, setRead] = useState<string[]>(() => readIds(userId));
  const readSet = useMemo(() => new Set(read), [read]);
  const markRead = useCallback(
    (ids: string[]) => {
      setRead((current) => {
        const next = [...new Set([...current, ...ids])];
        writeIds(userId, next);
        return next;
      });
    },
    [userId],
  );
  const isRead = useCallback((id: string) => readSet.has(id), [readSet]);
  return { isRead, markRead };
}

/** Live updates with read/unread, polling every 30 s while the screen is open. */
export function useUpdates(profile: NurseProfile, now: number) {
  const approved = profile.verificationStatus === 'approved';
  const poll = { pollMs: 30_000 };
  const dashboard = useNurseQuery((api) => api.cases.dashboard(), [], poll);
  const waiting = useNurseQuery(
    (api) => (approved ? api.cases.list('waiting').then((p) => p.items) : Promise.resolve([])),
    [approved],
    poll,
  );
  const earnings = useNurseQuery((api) => api.earnings.get(), [], poll);
  const { isRead, markRead } = useReadState(profile.userId);

  const updates = useMemo(
    () =>
      buildUpdates({
        profile,
        dashboard: dashboard.data,
        waiting: waiting.data,
        earnings: earnings.data,
        now,
      }),
    [profile, dashboard.data, waiting.data, earnings.data, now],
  );
  const unreadCount = updates.filter((u) => !isRead(u.id)).length;

  const status =
    dashboard.status === 'loading' && earnings.status === 'loading'
      ? 'loading'
      : dashboard.status === 'error' && earnings.status === 'error'
        ? 'error'
        : 'success';

  const reload = () => {
    dashboard.reload();
    waiting.reload();
    earnings.reload();
  };

  return {
    status,
    error: dashboard.error ?? earnings.error,
    updates,
    isRead,
    unreadCount,
    markRead,
    reload,
  } as const;
}
