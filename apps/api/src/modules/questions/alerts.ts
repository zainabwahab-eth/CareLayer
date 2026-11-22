// "A question is waiting" emails to nurses. Topic only, never the question (it stays in the app).
//   - New first-available question: every approved, available nurse with that topic (female only
//     if femaleOnly).                                                         (POST /questions, Z6)
//   - New chosen-nurse question: only her.                                    (POST /questions, Z6)
//   - Chosen window passed, or she released / her claim expired: everyone eligible, except the
//     chosen nurse (she was told already).                                    (sweeper / release, Z7)
// Never throws; failures are logged per nurse.
import type { Db } from '../../db.js';
import type { Logger } from '../../lib/logger.js';
import type { EmailSender } from '../auth/email.js';

export interface AlertDeps {
  db: Db;
  email: EmailSender;
  logger: Logger;
  nurseAppUrl: string;
}

export async function alertNurses(
  d: AlertDeps,
  q: { id: string; topicSlug: string; femaleOnly: boolean },
  target: { onlyNurseId: string } | { excludeNurseId?: string | null } = {},
) {
  try {
    const topic = await d.db.topic.findUnique({ where: { slug: q.topicSlug } });
    const only = 'onlyNurseId' in target ? target.onlyNurseId : null;
    const exclude = 'excludeNurseId' in target ? target.excludeNurseId : null;
    const nurses = await d.db.nurseProfile.findMany({
      where: only
        ? { userId: only }
        : {
            verificationStatus: 'APPROVED',
            available: true,
            topics: { some: { topicSlug: q.topicSlug } },
            ...(q.femaleOnly ? { gender: 'FEMALE' as const } : {}),
            ...(exclude ? { userId: { not: exclude } } : {}),
          },
      select: { user: { select: { email: true } } },
    });
    const results = await Promise.allSettled(
      nurses.map((n) =>
        d.email.sendNurseAlert({
          to: n.user.email,
          topicLabel: topic?.label ?? 'Health',
          chosenForYou: only !== null,
          url: `${d.nurseAppUrl}/cases`,
          questionId: q.id,
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    d.logger.info('nurse_alerts', {
      questionId: q.id,
      reason: only ? 'chosen' : exclude !== null && exclude !== undefined ? 'opened_to_all' : 'new',
      sent: results.length - failed,
      failed,
    });
  } catch (err) {
    d.logger.error('nurse_alerts_crashed', { questionId: q.id, error: (err as Error).message });
  }
}
