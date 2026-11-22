// Claiming and answering (Z7). Contract: docs/API_CONTRACT.md §9. Only APPROVED nurses reach these
// routes (guard in router.ts).
//
// Rules (decisions log):
//   - Visible ("waiting"): OPEN, claims not closed (now < expiresAt), femaleOnly false or she is
//     female, and the question has no chosen nurse, or the chosen window passed / fell back, or she
//     is the chosen nurse. Topics control alerts only: every eligible open question is visible.
//   - Claim: atomic. A conditional UPDATE (status OPEN, claims open) moves the question to CLAIMED
//     and the partial unique indexes allow one ACTIVE claim per nurse and per question. Lock: 10 min.
//   - Release / claim expiry: the question reopens (or EXPIRES if claims have closed). A chosen
//     nurse letting go opens it to everyone at once.
//   - Answer: only the claim holder, before the lock runs out.
//   - Time-based changes are applied lazily on every read/write here AND by the sweeper (every
//     30 s), so correctness never depends on the sweeper having run.
import type {
  AgeRange,
  Answer,
  NurseDashboard,
  NurseQuestionTab,
  NurseQuestionView,
  NurseRole,
  Page,
  QuestionCategory,
  QuestionStatus,
} from '@carelayer/shared';
import { CLAIM_LOCK_MINUTES } from '@carelayer/shared';
import type { Db } from '../../db.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { EmailSender } from '../auth/email.js';
import { alertNurses } from '../questions/alerts.js';
import { helpfulRating, recomputeNurseStats } from './stats.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Lagos is UTC+1 all year (no daylight saving). */
const LAGOS_OFFSET = 60 * MINUTE;

const lower = <T extends string>(v: T) => v.toLowerCase() as Lowercase<T>;

/** Midnight Lagos time of `now`'s Lagos day, as a UTC instant. */
export function lagosDayStart(now: Date): Date {
  const local = now.getTime() + LAGOS_OFFSET;
  return new Date(Math.floor(local / DAY) * DAY - LAGOS_OFFSET);
}

/** Monday 00:00 Lagos time of `now`'s Lagos week. */
export function lagosWeekStart(now: Date): Date {
  const day = lagosDayStart(now);
  const weekday = new Date(day.getTime() + LAGOS_OFFSET).getUTCDay(); // 0 = Sunday
  return new Date(day.getTime() - ((weekday + 6) % 7) * DAY);
}

type Tx = Prisma.TransactionClient;
type Nurse = { userId: string; gender: string | null };

/** Prisma filter for "she may claim this right now". */
export function waitingWhere(nurse: Nurse, now: Date): Prisma.QuestionWhereInput {
  return {
    status: 'OPEN',
    expiresAt: { gt: now },
    ...(nurse.gender === 'FEMALE' ? {} : { femaleOnly: false }),
    OR: [
      { chosenNurseId: null },
      { chosenNurseId: nurse.userId },
      { chosenUntil: { lte: now } },
      { fellBackAt: { not: null } },
    ],
  };
}

const viewInclude = {
  consent: { select: { sharedFields: true } },
  claims: { where: { status: 'ACTIVE' as const }, select: { nurseId: true, expiresAt: true } },
} satisfies Prisma.QuestionInclude;

type ViewRow = Prisma.QuestionGetPayload<{ include: typeof viewInclude }>;

/** The woman stays anonymous: no id, name, email, wallet or chat. originalText only if shared. */
export function toNurseQuestionView(q: ViewRow, nurseId: string, now: Date): NurseQuestionView {
  const mine = q.claims.find((c) => c.nurseId === nurseId && c.expiresAt > now);
  const shared = new Set(q.consent?.sharedFields ?? []);
  return {
    id: q.id,
    status: lower(q.status) as QuestionStatus,
    category: q.topicSlug as QuestionCategory,
    cleanedText: q.cleanedText,
    originalText: shared.has('ORIGINAL_TEXT') ? q.originalText : null,
    assistantNotes: q.assistantNotes,
    ageRange: q.ageRange ? (lower(q.ageRange) as AgeRange) : null,
    pregnancyWeeks: q.pregnancyWeeks,
    femaleOnly: q.femaleOnly,
    chosenForYou:
      q.chosenNurseId === nurseId &&
      q.fellBackAt === null &&
      q.chosenUntil !== null &&
      q.chosenUntil > now,
    claimsCloseAt: q.expiresAt.toISOString(),
    createdAt: q.createdAt.toISOString(),
    claimExpiresAt: mine ? mine.expiresAt.toISOString() : null,
  };
}

export interface ClaimEnd {
  questionId: string;
  outcome: 'reopened' | 'expired' | 'none';
  /** The chosen nurse let go: tell everyone else. */
  openedToAll: boolean;
}

/**
 * Ends one ACTIVE claim (released or lock expired) and moves its question on. Conditional on the
 * claim still being ACTIVE, so it is safe to call from the sweeper and a request at the same time.
 */
async function endClaim(
  tx: Tx,
  claim: { id: string; questionId: string; nurseId: string },
  to: 'RELEASED' | 'EXPIRED',
  now: Date,
): Promise<ClaimEnd | null> {
  const ended = await tx.claim.updateMany({
    where: { id: claim.id, status: 'ACTIVE' },
    data: { status: to, endedAt: now },
  });
  if (ended.count === 0) return null;
  const q = await tx.question.findUniqueOrThrow({ where: { id: claim.questionId } });
  if (q.status !== 'CLAIMED') return { questionId: q.id, outcome: 'none', openedToAll: false };
  if (now >= q.expiresAt) {
    await tx.question.update({ where: { id: q.id }, data: { status: 'EXPIRED', expiredAt: now } });
    return { questionId: q.id, outcome: 'expired', openedToAll: false };
  }
  const chosenLetGo = q.chosenNurseId === claim.nurseId && q.fellBackAt === null;
  await tx.question.update({
    where: { id: q.id },
    data: {
      status: 'OPEN',
      ...(chosenLetGo && {
        fellBackAt: now,
        chosenUntil: q.chosenUntil && q.chosenUntil < now ? q.chosenUntil : now,
      }),
    },
  });
  return { questionId: q.id, outcome: 'reopened', openedToAll: chosenLetGo };
}

export function createCaseService(d: {
  db: Db;
  email: EmailSender;
  logger: Logger;
  nurseAppUrl: string;
  webAppUrl: string;
  now: () => Date;
}) {
  const alertDeps = { db: d.db, email: d.email, logger: d.logger, nurseAppUrl: d.nurseAppUrl };

  async function afterClaimEnds(ends: (ClaimEnd | null)[]) {
    for (const e of ends) {
      if (!e?.openedToAll) continue;
      const q = await d.db.question.findUnique({ where: { id: e.questionId } });
      if (q) void alertNurses(alertDeps, q, { excludeNurseId: q.chosenNurseId });
    }
  }

  /** Ends any of her ACTIVE claims whose lock has run out (before the sweeper gets to them). */
  async function expireOwnStaleClaims(nurseId: string, now: Date) {
    const stale = await d.db.claim.findMany({
      where: { nurseId, status: 'ACTIVE', expiresAt: { lte: now } },
    });
    const ends = await Promise.all(
      stale.map((c) => d.db.$transaction((tx) => endClaim(tx, c, 'EXPIRED', now))),
    );
    await afterClaimEnds(ends);
  }

  async function nurseRow(nurseId: string): Promise<Nurse> {
    const n = await d.db.nurseProfile.findUniqueOrThrow({
      where: { userId: nurseId },
      select: { userId: true, gender: true },
    });
    return n;
  }

  async function view(questionId: string, nurseId: string, now: Date) {
    const q = await d.db.question.findUniqueOrThrow({
      where: { id: questionId },
      include: viewInclude,
    });
    return toNurseQuestionView(q, nurseId, now);
  }

  /** Visible to her: waiting for her, or she has (had) a claim on it. Else null (=> 404). */
  async function visibleQuestion(nurse: Nurse, questionId: string, now: Date) {
    return d.db.question.findFirst({
      where: {
        id: questionId,
        OR: [waitingWhere(nurse, now), { claims: { some: { nurseId: nurse.userId } } }],
      },
      include: viewInclude,
    });
  }

  return {
    async list(
      nurseId: string,
      query: { tab: NurseQuestionTab; cursor?: string; limit: number },
    ): Promise<Page<NurseQuestionView>> {
      const now = d.now();
      await expireOwnStaleClaims(nurseId, now);
      const nurse = await nurseRow(nurseId);

      if (query.tab === 'waiting') {
        const rows = await d.db.question.findMany({
          where: waitingWhere(nurse, now),
          include: viewInclude,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 100, // bounded by nature: only questions under 30 minutes old are open
        });
        const items = rows.map((q) => toNurseQuestionView(q, nurseId, now));
        // Questions reserved for her first: she has only 10 minutes.
        items.sort((a, b) => Number(b.chosenForYou) - Number(a.chosenForYou));
        return { items: items.slice(0, query.limit), nextCursor: null };
      }

      if (query.tab === 'active') {
        const claim = await d.db.claim.findFirst({
          where: { nurseId, status: 'ACTIVE', expiresAt: { gt: now } },
        });
        return {
          items: claim ? [await view(claim.questionId, nurseId, now)] : [],
          nextCursor: null,
        };
      }

      // completed: questions she answered, newest first.
      const after = query.cursor ? parseCursor(query.cursor) : null;
      if (query.cursor && !after) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Invalid cursor.', { field: 'cursor' });
      }
      const answers = await d.db.answer.findMany({
        where: {
          nurseId,
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: after.createdAt } },
                  { createdAt: after.createdAt, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        include: { question: { include: viewInclude } },
      });
      const page = answers.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((a) => toNurseQuestionView(a.question, nurseId, now)),
        nextCursor:
          answers.length > query.limit && last
            ? `${last.createdAt.toISOString()}|${last.id}`
            : null,
      };
    },

    async get(nurseId: string, questionId: string): Promise<NurseQuestionView> {
      const now = d.now();
      await expireOwnStaleClaims(nurseId, now);
      const q = await visibleQuestion(await nurseRow(nurseId), questionId, now);
      if (!q) throw new AppError(404, 'NOT_FOUND', 'Question not found.');
      return toNurseQuestionView(q, nurseId, now);
    },

    async current(nurseId: string): Promise<NurseQuestionView | null> {
      const now = d.now();
      await expireOwnStaleClaims(nurseId, now);
      const claim = await d.db.claim.findFirst({
        where: { nurseId, status: 'ACTIVE', expiresAt: { gt: now } },
      });
      return claim ? view(claim.questionId, nurseId, now) : null;
    },

    async claim(nurseId: string, questionId: string) {
      const now = d.now();
      await expireOwnStaleClaims(nurseId, now);
      const nurse = await nurseRow(nurseId);
      const q = await d.db.question.findUnique({ where: { id: questionId } });
      // Not visible to her (another nurse's reserved question, female-only, cancelled): 404.
      const eligible =
        q &&
        q.status !== 'CANCELLED' &&
        (nurse.gender === 'FEMALE' || !q.femaleOnly) &&
        (q.chosenNurseId === null ||
          q.chosenNurseId === nurseId ||
          q.fellBackAt !== null ||
          (q.chosenUntil !== null && q.chosenUntil <= now));
      if (!q || !eligible) throw new AppError(404, 'NOT_FOUND', 'Question not found.');
      if (q.status === 'EXPIRED') {
        throw new AppError(410, 'QUESTION_EXPIRED', 'This question has expired.');
      }
      if (q.status === 'CLAIMED' || q.status === 'ANSWERED') {
        throw new AppError(409, 'QUESTION_ALREADY_CLAIMED', 'Another nurse took this question.');
      }
      if (now >= q.expiresAt) {
        throw new AppError(409, 'CLAIMS_CLOSED', 'This question is closed to new claims.');
      }
      const mineActive = await d.db.claim.findFirst({ where: { nurseId, status: 'ACTIVE' } });
      if (mineActive) {
        throw new AppError(
          409,
          'ACTIVE_CLAIM_EXISTS',
          'Finish or release your current question first.',
          {
            questionId: mineActive.questionId,
          },
        );
      }
      const expiresAt = new Date(now.getTime() + CLAIM_LOCK_MINUTES * MINUTE);
      try {
        await d.db.$transaction(async (tx) => {
          const taken = await tx.question.updateMany({
            where: { id: questionId, status: 'OPEN', expiresAt: { gt: now } },
            data: { status: 'CLAIMED' },
          });
          if (taken.count === 0) {
            throw new AppError(
              409,
              'QUESTION_ALREADY_CLAIMED',
              'Another nurse took this question.',
            );
          }
          await tx.claim.create({
            data: { questionId, nurseId, status: 'ACTIVE', claimedAt: now, expiresAt },
          });
        });
      } catch (err) {
        // The partial unique indexes are the last line: a second claim racing in loses here.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = String(err.meta?.target ?? '') + String(err.message);
          throw target.includes('per_nurse')
            ? new AppError(
                409,
                'ACTIVE_CLAIM_EXISTS',
                'Finish or release your current question first.',
              )
            : new AppError(409, 'QUESTION_ALREADY_CLAIMED', 'Another nurse took this question.');
        }
        throw err;
      }
      d.logger.info('question_claimed', { questionId, nurseId });
      return { questionId, expiresAt: expiresAt.toISOString() };
    },

    async release(nurseId: string, questionId: string) {
      const now = d.now();
      const claim = await d.db.claim.findFirst({
        where: { nurseId, questionId },
        orderBy: { claimedAt: 'desc' },
      });
      if (!claim) throw new AppError(403, 'NOT_CLAIM_OWNER', 'You do not hold this question.');
      if (claim.status !== 'ACTIVE' || claim.expiresAt <= now) {
        await expireOwnStaleClaims(nurseId, now);
        if (claim.status === 'ACTIVE' || claim.status === 'EXPIRED') {
          throw new AppError(410, 'CLAIM_EXPIRED', 'Your 10 minutes on this question ran out.');
        }
        throw new AppError(403, 'NOT_CLAIM_OWNER', 'You do not hold this question.');
      }
      const end = await d.db.$transaction((tx) => endClaim(tx, claim, 'RELEASED', now));
      if (!end)
        throw new AppError(410, 'CLAIM_EXPIRED', 'Your 10 minutes on this question ran out.');
      d.logger.info('question_released', { questionId, nurseId, outcome: end.outcome });
      await afterClaimEnds([end]);
    },

    async answer(
      nurseId: string,
      questionId: string,
      body: { text: string; recommendSeeSomeoneToday?: boolean },
    ): Promise<Answer> {
      const now = d.now();
      const claim = await d.db.claim.findFirst({
        where: { nurseId, questionId },
        orderBy: { claimedAt: 'desc' },
      });
      if (!claim || claim.status === 'RELEASED' || claim.status === 'ANSWERED') {
        throw new AppError(403, 'NOT_CLAIM_OWNER', 'You do not hold this question.');
      }
      if (claim.status === 'EXPIRED' || claim.expiresAt <= now) {
        await expireOwnStaleClaims(nurseId, now);
        throw new AppError(410, 'CLAIM_EXPIRED', 'Your 10 minutes on this question ran out.');
      }
      const result = await d.db.$transaction(async (tx) => {
        const done = await tx.claim.updateMany({
          where: { id: claim.id, status: 'ACTIVE', expiresAt: { gt: now } },
          data: { status: 'ANSWERED', endedAt: now },
        });
        if (done.count === 0) {
          throw new AppError(410, 'CLAIM_EXPIRED', 'Your 10 minutes on this question ran out.');
        }
        const answer = await tx.answer.create({
          data: {
            questionId,
            claimId: claim.id,
            nurseId,
            text: body.text,
            recommendSeeSomeoneToday: body.recommendSeeSomeoneToday ?? false,
            createdAt: now,
          },
          include: { nurse: true },
        });
        const question = await tx.question.update({
          where: { id: questionId },
          data: { status: 'ANSWERED', answeredAt: now },
          include: { woman: { include: { notificationPreference: true } } },
        });
        await recomputeNurseStats(tx, nurseId);
        return { answer, question };
      });

      const { answer, question } = result;
      d.logger.info('question_answered', {
        questionId,
        nurseId,
        recommendSeeSomeoneToday: answer.recommendSeeSomeoneToday,
        responseSeconds: Math.round((now.getTime() - question.createdAt.getTime()) / 1000),
      });
      const woman = question.woman;
      if (woman && (woman.notificationPreference?.notifyWhenAnswered ?? true)) {
        void d.email
          .sendAnswerReady({
            to: woman.email,
            url: `${d.webAppUrl}/questions/${questionId}`,
            questionId,
          })
          .catch((err) =>
            d.logger.error('answer_ready_email_failed', {
              questionId,
              error: (err as Error).message,
            }),
          );
      }
      return {
        questionId,
        text: answer.text,
        nurse: {
          id: answer.nurse.userId,
          displayName: answer.nurse.fullName,
          role: (answer.nurse.role ? lower(answer.nurse.role) : 'nurse') as NurseRole,
          verified: true,
        },
        recommendSeeSomeoneToday: answer.recommendSeeSomeoneToday,
        answeredAt: answer.createdAt.toISOString(),
      };
    },

    async dashboard(nurseId: string): Promise<NurseDashboard> {
      const now = d.now();
      await expireOwnStaleClaims(nurseId, now);
      const profile = await d.db.nurseProfile.findUniqueOrThrow({
        where: { userId: nurseId },
        include: { topics: { include: { topic: true } } },
      });
      const approved = profile.verificationStatus === 'APPROVED';
      const nurse = { userId: nurseId, gender: profile.gender };
      const [claim, waitingCount, chosenForYouCount, answeredToday, answeredThisWeek] =
        await Promise.all([
          d.db.claim.findFirst({ where: { nurseId, status: 'ACTIVE', expiresAt: { gt: now } } }),
          approved ? d.db.question.count({ where: waitingWhere(nurse, now) }) : 0,
          approved
            ? d.db.question.count({
                where: {
                  ...waitingWhere(nurse, now),
                  chosenNurseId: nurseId,
                  fellBackAt: null,
                  chosenUntil: { gt: now },
                },
              })
            : 0,
          d.db.answer.count({ where: { nurseId, createdAt: { gte: lagosDayStart(now) } } }),
          d.db.answer.count({ where: { nurseId, createdAt: { gte: lagosWeekStart(now) } } }),
        ]);
      return {
        verificationStatus: lower(
          profile.verificationStatus,
        ) as NurseDashboard['verificationStatus'],
        available: profile.available,
        topics: [...profile.topics]
          .sort((a, b) => a.topic.sortOrder - b.topic.sortOrder)
          .map((t) => t.topicSlug as QuestionCategory),
        activeClaim: claim ? await view(claim.questionId, nurseId, now) : null,
        waitingCount,
        chosenForYouCount,
        answeredToday,
        answeredThisWeek,
        avgResponseMinutes:
          profile.avgResponseSeconds === null ? null : Math.round(profile.avgResponseSeconds / 60),
        helpful: helpfulRating(profile.helpfulCount, profile.feedbackCount),
      };
    },

    /**
     * The sweeper (every 30 s from index.ts; also safe to run by hand):
     *   1. claims past their 10-minute lock -> EXPIRED; question reopens, or EXPIRES if claims closed
     *   2. chosen-nurse questions past their 10-minute window -> open to everyone (+ alerts)
     *   3. OPEN questions past 30 minutes -> EXPIRED (she pays nothing)
     */
    async sweep() {
      const now = d.now();
      const staleClaims = await d.db.claim.findMany({
        where: { status: 'ACTIVE', expiresAt: { lte: now } },
        take: 200,
      });
      const ends = await Promise.all(
        staleClaims.map((c) => d.db.$transaction((tx) => endClaim(tx, c, 'EXPIRED', now))),
      );
      await afterClaimEnds(ends);

      const windowsPassed = await d.db.question.findMany({
        where: {
          status: 'OPEN',
          chosenNurseId: { not: null },
          fellBackAt: null,
          chosenUntil: { lte: now },
          expiresAt: { gt: now },
        },
        take: 200,
      });
      let openedToAll = 0;
      for (const q of windowsPassed) {
        const r = await d.db.question.updateMany({
          where: { id: q.id, status: 'OPEN', fellBackAt: null },
          data: { fellBackAt: now },
        });
        if (r.count === 1) {
          openedToAll++;
          void alertNurses(alertDeps, q, { excludeNurseId: q.chosenNurseId });
        }
      }

      const expired = await d.db.question.updateMany({
        where: { status: 'OPEN', expiresAt: { lte: now } },
        data: { status: 'EXPIRED', expiredAt: now },
      });

      const result = {
        claimsExpired: ends.filter(Boolean).length,
        openedToAll,
        questionsExpired: expired.count + ends.filter((e) => e?.outcome === 'expired').length,
      };
      if (result.claimsExpired || result.openedToAll || result.questionsExpired) {
        d.logger.info('sweeper', result);
      }
      return result;
    },
  };
}

function parseCursor(cursor: string) {
  const [iso, id] = cursor.split('|');
  const createdAt = iso ? new Date(iso) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

export type CaseService = ReturnType<typeof createCaseService>;
