import type { QuestionCategory } from '@carelayer/shared';

/** People-facing names for the AI-assigned categories (docs/TASKS.md decisions log). */
const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  pregnancy: 'Pregnancy',
  periods: 'Periods',
  contraception: 'Contraception',
  sexual_health: 'Sexual health',
  general: 'General',
};

export function categoryLabel(category: QuestionCategory): string {
  return CATEGORY_LABELS[category];
}
