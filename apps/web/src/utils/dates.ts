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

const longDay = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

/** "Tuesday, 11 November" (W05 desktop header). */
export function formatLongDay(date: Date = new Date()) {
  const parts = longDay.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${get('weekday')}, ${get('day')} ${get('month')}`;
}

/** "Good morning" / "Good afternoon" / "Good evening" by her local time (W05). */
export function greeting(date: Date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "Just now", "3 min ago", "2 h ago", then the list date (W05 active consultation). */
export function formatTimeAgo(iso: string, now: Date = new Date()) {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return formatListDate(iso);
}
