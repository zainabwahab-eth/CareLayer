import type { MyQuestion } from '@carelayer/shared';
import type { BadgeVariant } from '../../../components/Badge/Badge';
import { consultationPath, consultationWaitingPath } from '../../../routes/paths';
import { formatNaira } from '../../../utils/money';
import { nurseLine } from '../../../utils/nurses';

/*
 * How one of her questions is shown in W12 History (mobile cards and the
 * desktop table). Labels follow the Figma frames: "In review" / "Answered",
 * "Not charged yet" / "₦500" / "Free".
 */

export type HistoryFilter = 'all' | 'answered' | 'in_review';

export const HISTORY_FILTERS: ReadonlyArray<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'answered', label: 'Answered' },
  { value: 'in_review', label: 'In review' },
];

export function isInReview(question: MyQuestion) {
  return question.status === 'open' || question.status === 'claimed';
}

export function matchesFilter(question: MyQuestion, filter: HistoryFilter) {
  if (filter === 'answered') return question.status === 'answered';
  if (filter === 'in_review') return isInReview(question);
  return true;
}

/** Her question in her own words (spelling fixed). Never a summary. */
export function questionTitle(question: MyQuestion) {
  return question.cleanedText.trim() || question.originalText.trim();
}

export function statusBadge(question: MyQuestion): { label: string; variant: BadgeVariant } {
  switch (question.status) {
    case 'open':
    case 'claimed':
      return { label: 'In review', variant: 'accent' };
    case 'answered':
      return { label: 'Answered', variant: 'primary' };
    case 'expired':
      return { label: 'Expired', variant: 'neutral' };
    case 'cancelled':
      return { label: 'Cancelled', variant: 'neutral' };
  }
}

/** True once she has opened (and so paid for, or used a free answer on) the answer. */
export function isCollected(question: MyQuestion) {
  return question.status === 'answered' && question.answer !== null;
}

/**
 * What it cost her. Pay on delivery: nothing is charged until she opens the
 * answer, and an expired or cancelled question is never charged.
 */
export function costLabel(question: MyQuestion) {
  if (isCollected(question)) return question.isFree ? 'Free' : formatNaira(question.price);
  if (question.status === 'expired' || question.status === 'cancelled') return 'Not charged';
  return 'Not charged yet';
}

/** Who answered or will answer. The API only names the nurse once known to her. */
export function nurseLabel(question: MyQuestion) {
  const nurse = question.answer?.nurse ?? question.chosenNurse;
  if (nurse) return nurseLine(nurse);
  switch (question.status) {
    case 'open':
      return 'First available nurse';
    case 'claimed':
      return 'A nurse is reviewing it';
    case 'answered':
      return 'Answer ready to open';
    case 'expired':
      return 'No nurse was free in time';
    case 'cancelled':
      return 'Not sent to a nurse';
  }
}

export function questionLink(question: MyQuestion) {
  return isInReview(question)
    ? consultationWaitingPath(question.id)
    : consultationPath(question.id);
}

export interface HistoryStats {
  consultationsThisYear: number;
  spentThisYearKobo: number;
  spentAllTimeKobo: number;
  /** Null until at least one answer has been opened. */
  averageAnswerMinutes: number | null;
  freeAnswersUsed: number;
}

/**
 * Figma's summary ("4 consultations this year, ₦1,000 spent") and desktop stat
 * cards. Worked out from her full list, so only call it once every page is loaded.
 */
export function historyStats(questions: readonly MyQuestion[], now = new Date()): HistoryStats {
  const year = now.getFullYear();
  const thisYear = questions.filter(
    (q) => q.status !== 'cancelled' && new Date(q.createdAt).getFullYear() === year,
  );
  const collected = questions.filter(isCollected);
  const paidKobo = (list: readonly MyQuestion[]) =>
    list.filter((q) => isCollected(q) && !q.isFree).reduce((sum, q) => sum + q.price.kobo, 0);
  const answerMinutes = collected.map(
    (q) => (Date.parse(q.answer!.answeredAt) - Date.parse(q.createdAt)) / 60_000,
  );
  return {
    consultationsThisYear: thisYear.length,
    spentThisYearKobo: paidKobo(thisYear),
    spentAllTimeKobo: paidKobo(collected),
    averageAnswerMinutes: answerMinutes.length
      ? answerMinutes.reduce((sum, m) => sum + m, 0) / answerMinutes.length
      : null,
    freeAnswersUsed: collected.filter((q) => q.isFree).length,
  };
}

/** "8 min", "1 h 5 min". */
export function formatMinutes(minutes: number) {
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;
