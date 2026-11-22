// Questions (Z6): create, status, her list. Answers, payment and feedback are Z8; claims are Z7.
//
// Create, in order (contract §8.1):
//   1. Consent: cleaned_text and category must be shared (a nurse cannot answer without them).
//   2. Red flags (fixed list) on her original words: emergency, nothing created.
//   3. The question: the signed draft she saw on W07 (draftToken), or a fresh Mode B run (other
//      agents). The LLM's own red-flag judgement is checked too: emergency, nothing created.
//   4. Selection: a chosen nurse must be approved, available, and female if femaleOnly.
//   5. Spending limit: a paid answer above her limit needs approvedAboveLimit.
//   6. One write: question + consent. Fields she did not agree to share are not stored at all.
//   7. After the response: email alerts to the nurses who can take it.
import {
  CHOSEN_NURSE_WINDOW_MINUTES,
  QUESTION_CLAIMS_CLOSE_MINUTES,
  REQUIRED_SHARED_FIELDS,
  type AgeRange,
  type CreateQuestionBody,
  type CreatedQuestion,
  type EmergencyResponse,
  type MyQuestion,
  type MyQuestionsStatusFilter,
  type NurseRole,
  type Page,
  type PublicNurse,
  type QuestionCategory,
  type QuestionDraft,
  type QuestionStatus,
  type QuestionStatusResponse,
  type SharedField,
} from '@carelayer/shared';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { EmailSender } from '../auth/email.js';
import { recordEmergency } from '../emergency/service.js';
import { matchRedFlags, type RedFlag } from '../emergency/red-flags.js';
import type { Assistant } from '../llm/assistant.js';
import { llmToAppError } from '../llm/errors.js';
import { verifyDraftToken } from './draft-token.js';
import { moneyFromKobo, quoteFor } from './pricing.js';

const MINUTE = 60_000;

export interface QuestionServiceDeps {
  db: Db;
  config: Pick<Config, 'answerPriceKobo' | 'ngnPerUsdc' | 'nurseAppUrl'> & {
    auth: Pick<Config['auth'], 'jwtAccessSecret'>;
  };
  assistant: Assistant;
  redFlags: RedFlag[];
  email: EmailSender;
  logger: Logger;
  now: () => Date;
}

const toDbEnum = <T extends string>(v: T) => v.toUpperCase() as Uppercase<T>;
const toApiEnum = <T extends string>(v: T) => v.toLowerCase() as Lowercase<T>;

type QuestionWithRelations = Prisma.QuestionGetPayload<{
  include: {
    chosenNurse: true;
    answer: { include: { nurse: true; feedback: true } };
  };
}>;

function publicNurse(n: { userId: string; fullName: string; role: string | null }): PublicNurse {
  return {
    id: n.userId,
    displayName: n.fullName,
    role: (n.role ? toApiEnum(n.role) : 'nurse') as NurseRole,
    verified: true,
  };
}

export function toMyQuestion(q: QuestionWithRelations, ngnPerUsdc: string): MyQuestion {
  // The answer is shown once she has collected (paid for, or used a free answer on) it: Z8.
  const collected = q.status === 'ANSWERED' && q.collectedAt && q.answer;
  return {
    id: q.id,
    status: toApiEnum(q.status) as QuestionStatus,
    category: q.topicSlug as QuestionCategory,
    originalText: q.originalText,
    cleanedText: q.cleanedText,
    price: moneyFromKobo(q.priceKobo, ngnPerUsdc),
    isFree: q.isFree,
    nurseSelection: toApiEnum(q.selection) as MyQuestion['nurseSelection'],
    chosenNurse: q.chosenNurse ? publicNurse(q.chosenNurse) : null,
    femaleOnly: q.femaleOnly,
    claimsCloseAt: q.expiresAt.toISOString(),
    answer:
      collected && q.answer
        ? {
            questionId: q.id,
            text: q.answer.text,
            nurse: publicNurse(q.answer.nurse),
            recommendSeeSomeoneToday: q.answer.recommendSeeSomeoneToday,
            answeredAt: q.answer.createdAt.toISOString(),
          }
        : null,
    feedback: collected && q.answer?.feedback ? { helpful: q.answer.feedback.helpful } : null,
    createdAt: q.createdAt.toISOString(),
  };
}

const myQuestionInclude = {
  chosenNurse: true,
  answer: { include: { nurse: true, feedback: true } },
} as const;

/** Cursor = "<createdAt ISO>|<id>" of the last item. */
export function parseQuestionCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = cursor.split('|');
  const createdAt = iso ? new Date(iso) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

export function createQuestionService(d: QuestionServiceDeps) {
  /** Draft from the token, or a fresh one. Null draft = the LLM suspects an emergency. */
  async function resolveDraft(
    womanId: string,
    body: CreateQuestionBody,
  ): Promise<{ draft: QuestionDraft } | { emergency: true }> {
    if (body.draftToken) {
      const draft = await verifyDraftToken(
        body.draftToken,
        womanId,
        d.config.auth.jwtAccessSecret,
        d.now(),
      );
      if (!draft) {
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          'This draft has expired. Review your question again before sending it.',
          { field: 'draftToken' },
        );
      }
      if (draft.originalText !== body.originalText) {
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          'The question changed after it was reviewed. Review it again before sending it.',
          { field: 'originalText' },
        );
      }
      return { draft };
    }
    let prepared;
    try {
      prepared = await d.assistant.prepareQuestion(body.originalText);
    } catch (err) {
      throw llmToAppError(err);
    }
    if (prepared.redFlagSuspected) return { emergency: true };
    const { redFlagSuspected: _r, cleanupFellBack: _f, ...draft } = prepared;
    return { draft: { originalText: body.originalText, ...draft } };
  }

  async function chosenNurseFor(body: CreateQuestionBody) {
    if (body.nurseSelection !== 'chosen_nurse') return null;
    const nurse = await d.db.nurseProfile.findFirst({
      where: {
        userId: body.chosenNurseId!,
        verificationStatus: 'APPROVED',
        available: true,
        ...(body.femaleOnly ? { gender: 'FEMALE' as const } : {}),
      },
    });
    if (!nurse) {
      throw new AppError(
        409,
        'CHOSEN_NURSE_UNAVAILABLE',
        'That nurse cannot take questions right now. Choose someone else or "First available".',
      );
    }
    return nurse;
  }

  /** Email the nurses who can take it. Never throws; failures are logged per nurse. */
  async function alertNurses(q: {
    id: string;
    topicSlug: string;
    femaleOnly: boolean;
    chosenNurseId: string | null;
  }) {
    const topic = await d.db.topic.findUnique({ where: { slug: q.topicSlug } });
    const nurses = await d.db.nurseProfile.findMany({
      where: q.chosenNurseId
        ? { userId: q.chosenNurseId }
        : {
            verificationStatus: 'APPROVED',
            available: true,
            topics: { some: { topicSlug: q.topicSlug } },
            ...(q.femaleOnly ? { gender: 'FEMALE' as const } : {}),
          },
      select: { user: { select: { email: true } } },
    });
    const results = await Promise.allSettled(
      nurses.map((n) =>
        d.email.sendNurseAlert({
          to: n.user.email,
          topicLabel: topic?.label ?? 'Health',
          chosenForYou: q.chosenNurseId !== null,
          url: `${d.config.nurseAppUrl}/cases`,
          questionId: q.id,
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    d.logger.info('nurse_alerts', {
      questionId: q.id,
      sent: results.length - failed,
      failed,
    });
  }

  return {
    async create(
      womanId: string,
      body: CreateQuestionBody,
    ): Promise<{ status: 201; body: CreatedQuestion } | { status: 200; body: EmergencyResponse }> {
      const shared = new Set<SharedField>(body.consent.sharedFields);
      const missing = REQUIRED_SHARED_FIELDS.filter((f) => !shared.has(f));
      if (missing.length) {
        throw new AppError(
          400,
          'CONSENT_REQUIRED',
          'Agree to share your question and its topic with the nurse first.',
          { missing },
        );
      }

      const flagged = matchRedFlags(d.redFlags, body.originalText);
      if (flagged.length) {
        return { status: 200, body: await recordEmergency(d, 'QUESTION', flagged) };
      }
      const resolved = await resolveDraft(womanId, body);
      if ('emergency' in resolved) {
        return { status: 200, body: await recordEmergency(d, 'QUESTION', ['llm']) };
      }
      const { draft } = resolved;

      const chosen = await chosenNurseFor(body);
      const quote = await quoteFor(d.db, d.config, womanId);
      if (quote.exceedsSpendingLimit && !body.approvedAboveLimit) {
        throw new AppError(
          409,
          'SPENDING_LIMIT_EXCEEDED',
          'This answer costs more than your limit per answer. Approve it to send.',
          { priceKobo: quote.priceKobo, spendingLimitKobo: quote.spendingLimitKobo },
        );
      }

      const now = d.now();
      const q = await d.db.question.create({
        data: {
          womanId,
          source: 'WEB',
          originalText: body.originalText,
          cleanedText: draft.cleanedText,
          // Not shared = not stored.
          assistantNotes: shared.has('assistant_notes') ? draft.assistantNotes : null,
          topicSlug: draft.category,
          ageRange:
            shared.has('age_range') && draft.ageRange ? toDbEnum<AgeRange>(draft.ageRange) : null,
          pregnancyWeeks: shared.has('pregnancy_weeks') ? draft.pregnancyWeeks : null,
          femaleOnly: body.femaleOnly ?? false,
          selection: chosen ? 'CHOSEN_NURSE' : 'FIRST_AVAILABLE',
          chosenNurseId: chosen?.userId ?? null,
          chosenUntil: chosen
            ? new Date(now.getTime() + CHOSEN_NURSE_WINDOW_MINUTES * MINUTE)
            : null,
          expiresAt: new Date(now.getTime() + QUESTION_CLAIMS_CLOSE_MINUTES * MINUTE),
          priceKobo: quote.priceKobo,
          priceStroops: quote.priceStroops,
          isFree: quote.isFree,
          createdAt: now,
          consent: {
            create: {
              sharedFields: [...shared].map((f) => toDbEnum(f)),
              consentVersion: body.consent.consentVersion,
              agreedAt: now,
            },
          },
        },
      });

      d.logger.info('question_created', {
        questionId: q.id,
        category: q.topicSlug,
        selection: q.selection,
        femaleOnly: q.femaleOnly,
        isFree: q.isFree,
        fromDraft: Boolean(body.draftToken),
      });
      void alertNurses(q).catch((err) =>
        d.logger.error('nurse_alerts_crashed', { questionId: q.id, error: (err as Error).message }),
      );

      return {
        status: 201,
        body: {
          kind: 'question',
          id: q.id,
          status: 'open',
          category: q.topicSlug as QuestionCategory,
          price: quote.price,
          isFree: q.isFree,
          nurseSelection: chosen ? 'chosen_nurse' : 'first_available',
          chosenUntil: q.chosenUntil?.toISOString() ?? null,
          claimsCloseAt: q.expiresAt.toISOString(),
          questionKey: null,
          createdAt: q.createdAt.toISOString(),
        },
      };
    },

    async status(womanId: string, id: string): Promise<QuestionStatusResponse> {
      const q = await d.db.question.findFirst({ where: { id, womanId } });
      if (!q) throw new AppError(404, 'NOT_FOUND', 'Question not found.');
      return {
        id: q.id,
        status: toApiEnum(q.status) as QuestionStatus,
        category: q.topicSlug as QuestionCategory,
        claimsCloseAt: q.expiresAt.toISOString(),
        answeredAt: q.answeredAt?.toISOString() ?? null,
        expiredAt: q.expiredAt?.toISOString() ?? null,
      };
    },

    async getMine(womanId: string, id: string): Promise<MyQuestion> {
      const q = await d.db.question.findFirst({
        where: { id, womanId },
        include: myQuestionInclude,
      });
      if (!q) throw new AppError(404, 'NOT_FOUND', 'Question not found.');
      return toMyQuestion(q, d.config.ngnPerUsdc);
    },

    async listMine(
      womanId: string,
      query: { status?: MyQuestionsStatusFilter; cursor?: string; limit: number },
    ): Promise<Page<MyQuestion>> {
      const after = query.cursor ? parseQuestionCursor(query.cursor) : null;
      if (query.cursor && !after) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Invalid cursor.', { field: 'cursor' });
      }
      const statusWhere: Prisma.QuestionWhereInput =
        query.status === 'active'
          ? { status: { in: ['OPEN', 'CLAIMED'] } }
          : query.status
            ? { status: toDbEnum<QuestionStatus>(query.status) }
            : {};
      const rows = await d.db.question.findMany({
        where: {
          womanId,
          ...statusWhere,
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
        include: myQuestionInclude,
      });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((q) => toMyQuestion(q, d.config.ngnPerUsdc)),
        nextCursor:
          rows.length > query.limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
      };
    },
  };
}

export type QuestionService = ReturnType<typeof createQuestionService>;
