/*
 * Date labels used in lists (W12 History, wallet activity), matching Figma:
 * "Today", "Yesterday", "Mon, 3 Nov" (this week), "28 Oct" (this year),
 * "28 Oct 2025" (older). Always her local time zone.
 */
const LOCALE = 'en-GB';
const DAY_MS = 86_400_000;

const weekdayDay = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeOfDay = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
const fullDate = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'long', timeStyle: 'short' });

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export interface DateLabelOptions {
  /** Add the weekday for dates in the last week ("Mon, 3 Nov"). Mobile cards do; the desktop table does not. */
  weekday?: boolean;
  now?: Date;
}

export function formatListDate(
  iso: string,
  { weekday = false, now = new Date() }: DateLabelOptions = {},
) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (weekday && days > 1 && days < 7) return weekdayDay.format(date);
  if (date.getFullYear() === now.getFullYear()) return dayMonth.format(date);
  return dayMonthYear.format(date);
}

/** "14:05". */
export function formatTime(iso: string) {
  return timeOfDay.format(new Date(iso));
}

/** Unambiguous date for `<time title>` and screen readers: "3 November 2026 at 14:05". */
export function formatFullDate(iso: string) {
  return fullDate.format(new Date(iso));
}
