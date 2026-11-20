// Settings and notification preferences (contract §3).
//   GET/PATCH /me/settings       any role. Nurses may only change `appearance`.
//   GET/PATCH /me/notifications  women only (email when a nurse answers).
// Rows are created at sign-up; accounts made before that (or by hand) get the defaults on first
// read, so these routes never 404.
import {
  SPENDING_LIMIT_KOBO,
  WOMEN_ONLY_SETTINGS,
  type Appearance,
  type NotificationPreferences,
  type QuickExitTarget,
  type UserSettings,
} from '@carelayer/shared';
import { z } from 'zod';
import type { Db } from '../../db.js';
import type { UserSettings as DbUserSettings } from '../../generated/prisma/client.js';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;
const limit = (label: string) =>
  z
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number of kobo.`)
    .min(SPENDING_LIMIT_KOBO.min, `${label} cannot be below ${naira(SPENDING_LIMIT_KOBO.min)}.`)
    .max(SPENDING_LIMIT_KOBO.max, `${label} can be at most ${naira(SPENDING_LIMIT_KOBO.max)}.`);

export const UpdateSettingsSchema = z
  .object({
    appearance: z.enum(['system', 'light', 'dark']),
    quickExitTarget: z.enum(['google', 'weather', 'news']),
    spendingLimitPerAnswerKobo: limit('Spending limit'),
    mcpSpendingLimitPerAnswerKobo: limit('Claude spending limit'),
    mcpAskBeforeEachPayment: z.boolean(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one setting to change.');

export const UpdateNotificationsSchema = z
  .object({ notifyWhenAnswered: z.boolean() })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one preference to change.');

/** Women-only fields a non-woman tried to change (empty = fine). */
export function forbiddenSettingsFor(
  role: 'woman' | 'nurse' | 'admin',
  body: Record<string, unknown>,
): string[] {
  if (role === 'woman') return [];
  return WOMEN_ONLY_SETTINGS.filter((k) => k in body);
}

export function toSettingsDto(s: DbUserSettings): UserSettings {
  return {
    appearance: s.appearance.toLowerCase() as Appearance,
    quickExitTarget: s.quickExitTarget.toLowerCase() as QuickExitTarget,
    spendingLimitPerAnswerKobo: s.spendingLimitPerAnswerKobo,
    mcpSpendingLimitPerAnswerKobo: s.mcpSpendingLimitPerAnswerKobo,
    mcpAskBeforeEachPayment: s.mcpAskBeforeEachPayment,
  };
}

export async function getSettings(db: Db, userId: string): Promise<UserSettings> {
  const row = await db.userSettings.upsert({ where: { userId }, update: {}, create: { userId } });
  return toSettingsDto(row);
}

export async function updateSettings(
  db: Db,
  userId: string,
  body: z.infer<typeof UpdateSettingsSchema>,
): Promise<UserSettings> {
  const data = {
    ...(body.appearance && { appearance: body.appearance.toUpperCase() as 'SYSTEM' }),
    ...(body.quickExitTarget && {
      quickExitTarget: body.quickExitTarget.toUpperCase() as 'GOOGLE',
    }),
    ...(body.spendingLimitPerAnswerKobo !== undefined && {
      spendingLimitPerAnswerKobo: body.spendingLimitPerAnswerKobo,
    }),
    ...(body.mcpSpendingLimitPerAnswerKobo !== undefined && {
      mcpSpendingLimitPerAnswerKobo: body.mcpSpendingLimitPerAnswerKobo,
    }),
    ...(body.mcpAskBeforeEachPayment !== undefined && {
      mcpAskBeforeEachPayment: body.mcpAskBeforeEachPayment,
    }),
  };
  const row = await db.userSettings.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
  return toSettingsDto(row);
}

export async function getNotifications(db: Db, userId: string): Promise<NotificationPreferences> {
  const row = await db.notificationPreference.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  return { notifyWhenAnswered: row.notifyWhenAnswered };
}

export async function updateNotifications(
  db: Db,
  userId: string,
  body: z.infer<typeof UpdateNotificationsSchema>,
): Promise<NotificationPreferences> {
  const row = await db.notificationPreference.upsert({
    where: { userId },
    update: body,
    create: { userId, ...body },
  });
  return { notifyWhenAnswered: row.notifyWhenAnswered };
}
