// Admin verification (Z9). Contract: docs/API_CONTRACT.md §11.
// The admin checks the licence by hand against the NMCN register, using the uploaded documents
// (signed 10-minute links), then approves or rejects. Decisions are conditional updates on
// PENDING_REVIEW, so two admins clicking at once cannot both decide.
import type {
  AdminNurseDetail,
  AdminNurseSummary,
  NurseRole,
  Page,
  VerificationStatus,
} from '@carelayer/shared';
import type { Db } from '../../db.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { EmailSender } from '../auth/email.js';
import { signDocumentLink } from '../nurses/documents.js';
import type { NurseProfileService } from '../nurses/profile.js';
import { toNurseProfileDto } from '../nurses/profile.js';

const lower = <T extends string>(v: T) => v.toLowerCase() as Lowercase<T>;

function summary(n: {
  userId: string;
  fullName: string;
  role: string | null;
  licenceNumber: string | null;
  verificationStatus: string;
  submittedAt: Date | null;
}): AdminNurseSummary {
  return {
    userId: n.userId,
    fullName: n.fullName,
    role: n.role ? (lower(n.role) as NurseRole) : null,
    licenceNumber: n.licenceNumber,
    verificationStatus: lower(n.verificationStatus) as VerificationStatus,
    submittedAt: n.submittedAt?.toISOString() ?? null,
  };
}

/** Cursor = "<createdAt ISO>|<userId>" of the last item. */
function parseCursor(cursor: string) {
  const [iso, id] = cursor.split('|');
  const createdAt = iso ? new Date(iso) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

export function createAdminService(d: {
  db: Db;
  profiles: NurseProfileService;
  email: EmailSender;
  jwtAccessSecret: string;
  nurseAppUrl: string;
  logger: Logger;
  now: () => Date;
}) {
  async function decide(
    adminId: string,
    nurseId: string,
    decision: { approved: true } | { approved: false; reason: string },
  ) {
    const now = d.now();
    const updated = await d.db.nurseProfile.updateMany({
      where: { userId: nurseId, verificationStatus: 'PENDING_REVIEW' },
      data: decision.approved
        ? {
            verificationStatus: 'APPROVED',
            reviewedAt: now,
            reviewedById: adminId,
            rejectionReason: null,
          }
        : {
            verificationStatus: 'REJECTED',
            reviewedAt: now,
            reviewedById: adminId,
            rejectionReason: decision.reason,
            available: false,
          },
    });
    if (updated.count === 0) {
      const exists = await d.db.nurseProfile.findUnique({ where: { userId: nurseId } });
      if (!exists) throw new AppError(404, 'NOT_FOUND', 'Nurse not found.');
      throw new AppError(409, 'CONFLICT', 'Only a profile waiting for review can be decided.', {
        verificationStatus: lower(exists.verificationStatus),
      });
    }
    const n = await d.profiles.load(nurseId);
    d.logger.info('nurse_reviewed', { nurseId, adminId, approved: decision.approved });
    void d.email
      .sendNurseReview({
        to: n.user.email,
        fullName: n.fullName,
        approved: decision.approved,
        reason: decision.approved ? null : decision.reason,
        url: d.nurseAppUrl,
        reviewedAt: now,
      })
      .catch((err) =>
        d.logger.error('nurse_review_email_failed', { nurseId, error: (err as Error).message }),
      );
    return summary(n);
  }

  return {
    async list(query: {
      status: VerificationStatus;
      cursor?: string;
      limit: number;
    }): Promise<Page<AdminNurseSummary>> {
      const after = query.cursor ? parseCursor(query.cursor) : null;
      if (query.cursor && !after) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Invalid cursor.', { field: 'cursor' });
      }
      // Oldest first: whoever has waited longest is reviewed first.
      const rows = await d.db.nurseProfile.findMany({
        where: {
          verificationStatus: query.status.toUpperCase() as 'PENDING_REVIEW',
          ...(after
            ? {
                OR: [
                  { createdAt: { gt: after.createdAt } },
                  { createdAt: after.createdAt, userId: { gt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(summary),
        nextCursor:
          rows.length > query.limit && last
            ? `${last.createdAt.toISOString()}|${last.userId}`
            : null,
      };
    },

    async detail(adminId: string, nurseId: string): Promise<AdminNurseDetail> {
      const n = await d.db.nurseProfile.findUnique({ where: { userId: nurseId } });
      if (!n) throw new AppError(404, 'NOT_FOUND', 'Nurse not found.');
      const row = await d.profiles.load(nurseId);
      const now = d.now();
      d.logger.info('admin_viewed_nurse', { nurseId, adminId });
      return {
        ...toNurseProfileDto(row),
        email: row.user.email,
        documentUrls: Object.fromEntries(
          row.documents.map((doc) => [
            doc.id,
            signDocumentLink(d.jwtAccessSecret, doc.id, adminId, now),
          ]),
        ),
      };
    },

    approve: (adminId: string, nurseId: string) => decide(adminId, nurseId, { approved: true }),
    reject: (adminId: string, nurseId: string, reason: string) =>
      decide(adminId, nurseId, { approved: false, reason }),
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
