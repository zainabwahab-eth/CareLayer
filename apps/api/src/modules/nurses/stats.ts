// Public-profile caches on NurseProfile: average response time and "% helpful (count)".
// Recompute after an answer is written (Z7) or feedback changes (Z8). The seed uses it too, so
// seeded profiles are consistent with seeded answers and feedback.
import type { Prisma } from '../../generated/prisma/client.js';

type Tx = Pick<Prisma.TransactionClient, 'answer' | 'feedback' | 'nurseProfile'>;

export async function recomputeNurseStats(db: Tx, nurseId: string) {
  const answers = await db.answer.findMany({
    where: { nurseId },
    select: { createdAt: true, question: { select: { createdAt: true } } },
  });
  const totalSeconds = answers.reduce(
    (sum, a) =>
      sum +
      Math.max(0, Math.round((a.createdAt.getTime() - a.question.createdAt.getTime()) / 1000)),
    0,
  );
  const avgResponseSeconds = answers.length ? Math.round(totalSeconds / answers.length) : null;

  const [feedbackCount, helpfulCount] = await Promise.all([
    db.feedback.count({ where: { answer: { nurseId } } }),
    db.feedback.count({ where: { answer: { nurseId }, helpful: true } }),
  ]);

  return db.nurseProfile.update({
    where: { userId: nurseId },
    data: { avgResponseSeconds, feedbackCount, helpfulCount },
  });
}

/** 96% helpful (212). Null percent until the first feedback. */
export function helpfulRating(helpfulCount: number, feedbackCount: number) {
  return {
    percent: feedbackCount ? Math.round((helpfulCount / feedbackCount) * 100) : null,
    count: feedbackCount,
  };
}
