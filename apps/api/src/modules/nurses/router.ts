// Nurses module. Contract: docs/API_CONTRACT.md §8.0, §10.
//
//   GET    /nurses?topic=&femaleOnly=     woman: approved, available nurses, public fields (Z6)
//   GET    /nurse/profile                 nurse: her own profile                          (Z9)
//   PATCH  /nurse/profile                 nurse: onboarding fields                        (Z9)
//   POST   /nurse/documents               nurse: multipart { type, file }                 (Z9)
//   DELETE /nurse/documents/:id           nurse                                           (Z9)
//   POST   /nurse/profile/submit          nurse: send for admin review                    (Z9)
//   PATCH  /nurse/preferences             nurse: { topics?, available? }                  (Z9)
//   PUT    /nurse/payout-address          nurse + fresh code                              (Z9)
//   GET    /files/nurse-documents/:id     signed admin link only (no bearer)              (Z9)
//   GET    /nurse/dashboard               nurse: Today screen (any verification status)   (Z7)
//   GET    /nurse/questions?tab=          approved nurse: waiting | active | completed    (Z7)
//   GET    /nurse/questions/:id           approved nurse                                  (Z7)
//   GET    /nurse/claim                   approved nurse: current claim or null           (Z7)
//   POST   /nurse/questions/:id/claim     approved nurse                                  (Z7)
//   POST   /nurse/questions/:id/release   approved nurse                                  (Z7)
//   POST   /nurse/questions/:id/answer    approved nurse: { text, recommendSeeSomeoneToday }(Z7)
//   GET    /nurse/earnings                nurse: N09 (balance, week chart, month, recent)  (Z10)
//   GET    /nurse/withdrawals             nurse: ?cursor=&limit=                           (Z10)
//   POST   /nurse/withdrawals             nurse + fresh code: Stellar address only         (Z10)
//
// Everything under /nurse/* requires a signed-in NURSE (guard on the prefix). /nurse/questions*
// and /nurse/claim also require an APPROVED nurse, mounted now so Z7's routes are protected by
// default. (/nurses, the directory, is a different path.)
import {
  ANSWER_TEXT_MAX_LENGTH,
  NURSE_DOCUMENT_TYPES,
  NURSE_DOCUMENT_UPLOAD,
  NURSE_QUESTION_TABS,
  QUESTION_CATEGORIES,
} from '@carelayer/shared';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { getAuth, requireAuth, requireFreshCode, requireRole } from '../auth/middleware.js';
import type { CaseService } from './cases.js';
import type { EarningsService } from './earnings.js';
import { listNurseDirectory } from './directory.js';
import { readDocumentFile, verifyDocumentLink } from './documents.js';
import {
  PayoutAddressSchema,
  UpdateNurseProfileSchema,
  UpdatePreferencesSchema,
  type NurseProfileService,
} from './profile.js';

const CasesQuerySchema = z.object({
  tab: z.enum(NURSE_QUESTION_TABS).default('waiting'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be 1-100')
    .max(100, 'limit must be 1-100')
    .default(20),
});

const AnswerSchema = z
  .object({
    text: z
      .string({ error: 'Write your answer.' })
      .trim()
      .min(1, 'Write your answer.')
      .max(ANSWER_TEXT_MAX_LENGTH, `Answers can be up to ${ANSWER_TEXT_MAX_LENGTH} characters.`),
    recommendSeeSomeoneToday: z.boolean().optional(),
  })
  .strict();

const PageSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be 1-100')
    .max(100, 'limit must be 1-100')
    .default(20),
});

const WithdrawalSchema = z
  .object({
    amountKobo: z
      .number({ error: 'amountKobo must be a whole number of kobo.' })
      .int('amountKobo must be a whole number of kobo.')
      .positive('amountKobo must be positive.')
      .max(Number.MAX_SAFE_INTEGER),
    destination: z
      .object({
        kind: z.literal('stellar', { error: 'Only Stellar withdrawals are available for now.' }),
        address: z.string({ error: 'Enter a Stellar address.' }).trim().min(1).max(100),
      })
      .strict(),
  })
  .strict();

const DirectoryQuerySchema = z.object({
  topic: z.enum(QUESTION_CATEGORIES).optional(),
  femaleOnly: z
    .enum(['true', 'false', '1', '0'], { error: 'femaleOnly must be true or false' })
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

const DocumentTypeSchema = z.enum(NURSE_DOCUMENT_TYPES, {
  error: `type must be one of: ${NURSE_DOCUMENT_TYPES.join(', ')}`,
});

/** One file in memory, size-capped; multer errors become contract-shaped 400/413s. */
function singleUpload(): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: NURSE_DOCUMENT_UPLOAD.maxBytes, files: 1, fields: 5, fieldSize: 1024 },
  }).single('file');
  return (req, res, next) => {
    upload(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError(413, 'VALIDATION_FAILED', 'Files can be up to 10 MB.', { field: 'file' }),
          );
        }
        return next(
          new AppError(400, 'VALIDATION_FAILED', 'Send one file in the "file" field.', {
            field: err.field ?? 'file',
          }),
        );
      }
      next(err);
    });
  };
}

export function createNursesRouter(
  deps: AppDeps,
  profiles: NurseProfileService,
  cases: CaseService,
  earnings: EarningsService,
): Router {
  const router = Router();
  const now = deps.clock ?? (() => new Date());
  const authed = requireAuth({
    db: deps.db,
    jwtAccessSecret: deps.config.auth.jwtAccessSecret,
    now,
  });

  router.get('/nurses', authed, requireRole('woman'), async (req, res) => {
    const query = DirectoryQuerySchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await listNurseDirectory(deps.db, query));
  });

  // Signed, short-lived document links for admins (from GET /admin/nurses/:id). No bearer: the
  // link itself is the credential, so it can open in a new tab or an <img>.
  router.get('/files/nurse-documents/:id', async (req, res) => {
    const id = String(req.params.id);
    const check = verifyDocumentLink(deps.config.auth.jwtAccessSecret, id, req.query, now());
    if (check !== 'ok') {
      throw check === 'expired'
        ? new AppError(
            410,
            'LINK_EXPIRED',
            'This link has expired. Open the nurse again for a new one.',
          )
        : new AppError(403, 'FORBIDDEN', 'This link is not valid.');
    }
    const doc = await deps.db.nurseDocument.findUnique({ where: { id } });
    const bytes = doc ? await readDocumentFile(deps.db, doc.storageKey) : null;
    if (!doc || !bytes) throw new AppError(404, 'NOT_FOUND', 'Document not found.');
    deps.logger.info('nurse_document_viewed', { documentId: id, adminId: String(req.query.a) });
    res.set({
      'Content-Type': doc.mimeType,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${doc.fileName.replace(/[^\w.() -]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Referrer-Policy': 'no-referrer',
    });
    res.end(Buffer.from(bytes));
  });

  router.use('/nurse', authed, requireRole('nurse'));

  // Z7's claim routes are for approved nurses only.
  const approvedOnly: RequestHandler = async (_req, res, next) => {
    try {
      const n = await deps.db.nurseProfile.findUnique({ where: { userId: getAuth(res).userId } });
      if (n?.verificationStatus !== 'APPROVED') {
        return next(
          new AppError(
            403,
            'NURSE_NOT_APPROVED',
            'Your profile must be approved before you can see questions.',
          ),
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
  router.use(['/nurse/questions', '/nurse/claim'], approvedOnly);

  router.get('/nurse/profile', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await profiles.get(getAuth(res).userId));
  });

  router.patch('/nurse/profile', async (req, res) => {
    const body = UpdateNurseProfileSchema.parse(req.body);
    res.json(await profiles.update(getAuth(res).userId, body));
  });

  router.post('/nurse/profile/submit', async (_req, res) => {
    res.json(await profiles.submit(getAuth(res).userId));
  });

  router.post('/nurse/documents', singleUpload(), async (req, res) => {
    const type = DocumentTypeSchema.safeParse((req.body as { type?: unknown } | undefined)?.type);
    if (!type.success) {
      throw new AppError(400, 'VALIDATION_FAILED', type.error.issues[0]!.message, {
        field: 'type',
      });
    }
    if (!req.file) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Choose a file to upload.', { field: 'file' });
    }
    const doc = await profiles.uploadDocument(getAuth(res).userId, {
      type: type.data,
      originalName: req.file.originalname,
      bytes: req.file.buffer,
    });
    res.status(201).json(doc);
  });

  router.delete('/nurse/documents/:id', async (req, res) => {
    await profiles.removeDocument(getAuth(res).userId, String(req.params.id));
    res.status(204).end();
  });

  router.patch('/nurse/preferences', async (req, res) => {
    const body = UpdatePreferencesSchema.parse(req.body);
    res.json(await profiles.updatePreferences(getAuth(res).userId, body));
  });

  router.put('/nurse/payout-address', requireFreshCode(now), async (req, res) => {
    const { stellarAddress } = PayoutAddressSchema.parse(req.body);
    res.json(await profiles.setPayoutAddress(getAuth(res).userId, stellarAddress || null));
  });

  // ---- Earnings and withdrawals (Z10): any nurse (earned money stays hers whatever her status) ----
  router.get('/nurse/earnings', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await earnings.earnings(getAuth(res).userId));
  });

  router.get('/nurse/withdrawals', async (req, res) => {
    const page = PageSchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await earnings.list(getAuth(res).userId, page));
  });

  router.post('/nurse/withdrawals', requireFreshCode(now), async (req, res) => {
    const body = WithdrawalSchema.parse(req.body);
    const result = await earnings.withdraw(getAuth(res).userId, {
      amountKobo: body.amountKobo,
      address: body.destination.address,
    });
    res.status(result.status).json(result.body);
  });

  // ---- Cases (Z7) ----
  router.get('/nurse/dashboard', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await cases.dashboard(getAuth(res).userId));
  });

  router.get('/nurse/questions', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await cases.list(getAuth(res).userId, CasesQuerySchema.parse(req.query)));
  });

  router.get('/nurse/questions/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await cases.get(getAuth(res).userId, String(req.params.id)));
  });

  router.get('/nurse/claim', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await cases.current(getAuth(res).userId));
  });

  router.post('/nurse/questions/:id/claim', async (req, res) => {
    res.json(await cases.claim(getAuth(res).userId, String(req.params.id)));
  });

  router.post('/nurse/questions/:id/release', async (req, res) => {
    await cases.release(getAuth(res).userId, String(req.params.id));
    res.status(204).end();
  });

  router.post('/nurse/questions/:id/answer', async (req, res) => {
    const body = AnswerSchema.parse(req.body);
    res.status(201).json(await cases.answer(getAuth(res).userId, String(req.params.id), body));
  });

  return router;
}
