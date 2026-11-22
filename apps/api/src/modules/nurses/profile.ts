// Nurse onboarding and profile (Z9). Contract: docs/API_CONTRACT.md §10.
//
// Lifecycle: DRAFT -> (submit) PENDING_REVIEW -> (admin) APPROVED | REJECTED -> (fix, submit) ...
// - Licence fields (full name, role, licence number, name confirmation) and documents are locked
//   while the admin is looking (PENDING_REVIEW) and once APPROVED: the approval was for them.
// - Topics default from the role the first time a role is set (midwives: pregnancy + periods;
//   nurses: all) and must never become empty.
import {
  DEFAULT_TOPICS_BY_ROLE,
  LICENCE_FIELDS,
  NURSE_BIO_MAX_LENGTH,
  NURSE_DOCUMENT_TYPES,
  NURSE_LANGUAGES,
  QUESTION_CATEGORIES,
  type Gender,
  type NurseDocumentType,
  type NurseLanguage,
  type NurseProfile,
  type NurseRole,
  type OnboardingRequirement,
  type QuestionCategory,
  type VerificationStatus,
} from '@carelayer/shared';
import { StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';
import type { Db } from '../../db.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { deleteDocument, detectDocumentType, safeFileName, storeDocument } from './documents.js';
import { helpfulRating } from './stats.js';

const lower = <T extends string>(v: T) => v.toLowerCase() as Lowercase<T>;
const upper = <T extends string>(v: T) => v.toUpperCase() as Uppercase<T>;

export const UpdateNurseProfileSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name as on your licence.').max(100),
    role: z.enum(['nurse', 'midwife']),
    fullNameConfirmed: z.boolean(),
    gender: z.enum(['female', 'male', 'prefer_not_to_say']).nullable(),
    practiceArea: z.string().trim().min(2).max(100),
    yearsOfPractice: z.number().int('Use whole years.').min(0).max(60),
    bio: z
      .string()
      .trim()
      .max(NURSE_BIO_MAX_LENGTH, `Keep your bio to ${NURSE_BIO_MAX_LENGTH} characters.`),
    languages: z
      .array(z.enum(NURSE_LANGUAGES))
      .min(1, 'Choose at least one language.')
      .refine((l) => new Set(l).size === l.length, 'Languages has duplicates.'),
    licenceNumber: z
      .string()
      .trim()
      .min(3, 'Enter your licence number.')
      .max(40)
      .regex(/^[A-Za-z0-9/ -]+$/, 'Use letters, numbers, spaces, - or / only.')
      .transform((v) => v.toUpperCase().replace(/\s+/g, ' ')),
    guidanceNotDiagnosisAccepted: z.boolean(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change.');

export const UpdatePreferencesSchema = z
  .object({
    topics: z
      .array(z.enum(QUESTION_CATEGORIES))
      .refine((t) => new Set(t).size === t.length, 'Topics has duplicates.'),
    available: z.boolean(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Send topics or available.');

export const PayoutAddressSchema = z
  .object({ stellarAddress: z.string().trim().nullable() })
  .strict();

const profileInclude = {
  documents: { orderBy: { type: 'asc' } },
  topics: { include: { topic: true } },
  user: { select: { email: true, wallet: { select: { stellarPublicKey: true } } } },
} as const satisfies Prisma.NurseProfileInclude;

export type ProfileRow = Prisma.NurseProfileGetPayload<{ include: typeof profileInclude }>;

export function toNurseProfileDto(n: ProfileRow): NurseProfile {
  return {
    userId: n.userId,
    role: n.role ? (lower(n.role) as NurseRole) : null,
    fullName: n.fullName,
    fullNameConfirmed: n.fullNameConfirmed,
    gender: n.gender ? (lower(n.gender) as Gender) : null,
    practiceArea: n.practiceArea,
    yearsOfPractice: n.yearsOfPractice,
    bio: n.bio,
    languages: n.languages.map((l) => lower(l) as NurseLanguage),
    licenceNumber: n.licenceNumber,
    documents: n.documents.map((d) => ({
      id: d.id,
      type: lower(d.type) as NurseDocumentType,
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
    custodialStellarAddress: n.user.wallet?.stellarPublicKey ?? '',
    ownStellarAddress: n.ownStellarAddress,
    guidanceNotDiagnosisAccepted: n.guidanceAcceptedAt !== null,
    verificationStatus: lower(n.verificationStatus) as VerificationStatus,
    rejectionReason: n.rejectionReason,
    topics: [...n.topics]
      .sort((a, b) => a.topic.sortOrder - b.topic.sortOrder)
      .map((t) => t.topicSlug as QuestionCategory),
    available: n.available,
    avgResponseMinutes:
      n.avgResponseSeconds === null ? null : Math.round(n.avgResponseSeconds / 60),
    helpful: helpfulRating(n.helpfulCount, n.feedbackCount),
  };
}

/** What is still missing before she can submit. Empty = ready. */
export function missingForSubmit(n: ProfileRow): OnboardingRequirement[] {
  const missing: OnboardingRequirement[] = [];
  if (!n.role) missing.push('role');
  if (!n.fullNameConfirmed) missing.push('fullNameConfirmed');
  if (n.yearsOfPractice === null) missing.push('yearsOfPractice');
  if (!n.licenceNumber) missing.push('licenceNumber');
  if (!n.guidanceAcceptedAt) missing.push('guidanceNotDiagnosisAccepted');
  const have = new Set(n.documents.map((d) => lower(d.type)));
  for (const t of NURSE_DOCUMENT_TYPES) if (!have.has(t)) missing.push(t);
  return missing;
}

const isLocked = (status: string) => status === 'PENDING_REVIEW' || status === 'APPROVED';

export function createNurseProfileService(d: { db: Db; logger: Logger; now: () => Date }) {
  async function load(nurseId: string): Promise<ProfileRow> {
    const n = await d.db.nurseProfile.findUnique({
      where: { userId: nurseId },
      include: profileInclude,
    });
    if (!n) throw new AppError(404, 'NOT_FOUND', 'Nurse profile not found.');
    return n;
  }

  return {
    load,
    get: async (nurseId: string) => toNurseProfileDto(await load(nurseId)),

    async update(nurseId: string, body: z.infer<typeof UpdateNurseProfileSchema>) {
      const n = await load(nurseId);
      const touched = LICENCE_FIELDS.filter((f) => f in body);
      if (touched.length && isLocked(n.verificationStatus)) {
        throw new AppError(
          409,
          'CONFLICT',
          n.verificationStatus === 'APPROVED'
            ? 'Your licence details are verified and cannot be changed here. Contact support.'
            : 'Your licence details are being reviewed. You can change them if the review asks you to.',
          { field: touched[0] },
        );
      }
      const setsRoleFirstTime = body.role !== undefined && n.topics.length === 0;
      try {
        await d.db.$transaction(async (tx) => {
          await tx.nurseProfile.update({
            where: { userId: nurseId },
            data: {
              ...(body.fullName !== undefined && { fullName: body.fullName }),
              ...(body.role !== undefined && { role: upper(body.role) }),
              ...(body.fullNameConfirmed !== undefined && {
                fullNameConfirmed: body.fullNameConfirmed,
              }),
              ...(body.gender !== undefined && { gender: body.gender ? upper(body.gender) : null }),
              ...(body.practiceArea !== undefined && { practiceArea: body.practiceArea }),
              ...(body.yearsOfPractice !== undefined && { yearsOfPractice: body.yearsOfPractice }),
              ...(body.bio !== undefined && { bio: body.bio || null }),
              ...(body.languages !== undefined && { languages: body.languages.map(upper) }),
              ...(body.licenceNumber !== undefined && { licenceNumber: body.licenceNumber }),
              ...(body.guidanceNotDiagnosisAccepted !== undefined && {
                guidanceAcceptedAt: body.guidanceNotDiagnosisAccepted ? d.now() : null,
              }),
            },
          });
          // Her name as on the licence is also what the app calls her.
          if (body.fullName !== undefined) {
            await tx.user.update({ where: { id: nurseId }, data: { displayName: body.fullName } });
          }
          if (setsRoleFirstTime) {
            await tx.nurseTopic.createMany({
              data: DEFAULT_TOPICS_BY_ROLE[body.role!].map((topicSlug) => ({ nurseId, topicSlug })),
              skipDuplicates: true,
            });
          }
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppError(409, 'CONFLICT', 'This licence number is already registered.', {
            field: 'licenceNumber',
          });
        }
        throw err;
      }
      return toNurseProfileDto(await load(nurseId));
    },

    async updatePreferences(nurseId: string, body: z.infer<typeof UpdatePreferencesSchema>) {
      if (body.topics !== undefined && body.topics.length === 0) {
        throw new AppError(400, 'TOPICS_REQUIRED', 'Choose at least one topic you answer.', {
          field: 'topics',
        });
      }
      await d.db.$transaction(async (tx) => {
        if (body.available !== undefined) {
          await tx.nurseProfile.update({
            where: { userId: nurseId },
            data: { available: body.available },
          });
        }
        if (body.topics !== undefined) {
          await tx.nurseTopic.deleteMany({ where: { nurseId } });
          await tx.nurseTopic.createMany({
            data: body.topics.map((topicSlug) => ({ nurseId, topicSlug })),
          });
        }
      });
      return toNurseProfileDto(await load(nurseId));
    },

    async uploadDocument(
      nurseId: string,
      input: { type: NurseDocumentType; originalName: string | undefined; bytes: Uint8Array },
    ) {
      const n = await load(nurseId);
      if (isLocked(n.verificationStatus)) {
        throw new AppError(
          409,
          'CONFLICT',
          'Documents cannot be changed while under review or after approval.',
        );
      }
      const mimeType = detectDocumentType(input.bytes);
      if (!mimeType) {
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          'Upload a PDF or a photo (JPEG, PNG, WebP or HEIC).',
          {
            field: 'file',
          },
        );
      }
      const doc = await storeDocument(d.db, {
        nurseId,
        type: input.type,
        fileName: safeFileName(input.originalName, input.type),
        mimeType,
        bytes: input.bytes,
        now: d.now(),
      });
      d.logger.info('nurse_document_uploaded', {
        nurseId,
        type: input.type,
        mimeType,
        sizeBytes: input.bytes.length,
      });
      return {
        id: doc.id,
        type: input.type,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        uploadedAt: doc.uploadedAt.toISOString(),
      };
    },

    async removeDocument(nurseId: string, documentId: string) {
      const n = await load(nurseId);
      const doc = n.documents.find((x) => x.id === documentId);
      if (!doc) throw new AppError(404, 'NOT_FOUND', 'Document not found.');
      if (isLocked(n.verificationStatus)) {
        throw new AppError(
          409,
          'CONFLICT',
          'Documents cannot be changed while under review or after approval.',
        );
      }
      await deleteDocument(d.db, doc);
    },

    async submit(nurseId: string) {
      const n = await load(nurseId);
      if (n.verificationStatus === 'PENDING_REVIEW') return toNurseProfileDto(n); // already sent
      if (n.verificationStatus === 'APPROVED') {
        throw new AppError(409, 'CONFLICT', 'You are already verified.');
      }
      const missing = missingForSubmit(n);
      if (missing.length) {
        throw new AppError(409, 'ONBOARDING_INCOMPLETE', 'Finish every step before submitting.', {
          missing,
        });
      }
      await d.db.nurseProfile.update({
        where: { userId: nurseId },
        data: { verificationStatus: 'PENDING_REVIEW', submittedAt: d.now(), rejectionReason: null },
      });
      d.logger.info('nurse_submitted', {
        nurseId,
        resubmission: n.verificationStatus === 'REJECTED',
      });
      return toNurseProfileDto(await load(nurseId));
    },

    async setPayoutAddress(nurseId: string, address: string | null) {
      if (address !== null && !StrKey.isValidEd25519PublicKey(address)) {
        throw new AppError(
          400,
          'STELLAR_ADDRESS_INVALID',
          'That is not a valid Stellar address (G…).',
          {
            field: 'stellarAddress',
          },
        );
      }
      await d.db.nurseProfile.update({
        where: { userId: nurseId },
        data: { ownStellarAddress: address },
      });
      d.logger.info('nurse_payout_address_changed', { nurseId, custodial: address === null });
      return toNurseProfileDto(await load(nurseId));
    },
  };
}

export type NurseProfileService = ReturnType<typeof createNurseProfileService>;
