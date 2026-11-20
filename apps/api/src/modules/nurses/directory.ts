// GET /nurses (W08 "Choose who answers"): approved, available nurses, public fields only.
// Never email, licence number, wallet or contact details.
import type {
  Gender,
  NurseLanguage,
  NursePublicProfile,
  NurseRole,
  QuestionCategory,
} from '@carelayer/shared';
import type { Db } from '../../db.js';
import { helpfulRating } from './stats.js';

const lower = <T extends string>(v: T) => v.toLowerCase();

export async function listNurseDirectory(
  db: Db,
  query: { topic?: QuestionCategory; femaleOnly?: boolean },
): Promise<NursePublicProfile[]> {
  const rows = await db.nurseProfile.findMany({
    where: {
      verificationStatus: 'APPROVED',
      available: true,
      role: { not: null },
      ...(query.topic ? { topics: { some: { topicSlug: query.topic } } } : {}),
      ...(query.femaleOnly ? { gender: 'FEMALE' as const } : {}),
    },
    include: { topics: { include: { topic: true } } },
  });
  return rows
    .map((n): NursePublicProfile => ({
      id: n.userId,
      fullName: n.fullName,
      role: lower(n.role!) as NurseRole,
      gender: n.gender ? (lower(n.gender) as Gender) : null,
      yearsOfPractice: n.yearsOfPractice ?? 0,
      bio: n.bio,
      languages: n.languages.map((l) => lower(l) as NurseLanguage),
      topics: [...n.topics]
        .sort((a, b) => a.topic.sortOrder - b.topic.sortOrder)
        .map((t) => t.topicSlug as QuestionCategory),
      available: n.available,
      verified: true,
      avgResponseMinutes:
        n.avgResponseSeconds === null ? null : Math.round(n.avgResponseSeconds / 60),
      helpful: helpfulRating(n.helpfulCount, n.feedbackCount),
    }))
    .sort(
      // Fastest responders first; nurses with no answers yet after them; then by name.
      (a, b) =>
        (a.avgResponseMinutes ?? Number.MAX_SAFE_INTEGER) -
          (b.avgResponseMinutes ?? Number.MAX_SAFE_INTEGER) || a.fullName.localeCompare(b.fullName),
    );
}
