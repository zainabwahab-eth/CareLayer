// Nurse documents (Z9): licence, certificate, ID, selfie with ID.
//
// Storage: Postgres (NurseDocumentFile), decided in Z9. Private by design: there is no file URL.
// The only way to read a file is a signed link an admin gets from GET /admin/nurses/:id, valid
// 10 minutes and bound to that admin (so every view is attributable in the logs).
// Swapping to a bucket later means changing storeDocument / readDocumentFile / deleteDocument here.
//
// The file type is detected from the first bytes, never trusted from the browser or the file
// name, and stored with the file. Served back with nosniff and a sandboxing CSP.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NurseDocumentType } from '@carelayer/shared';
import type { Db } from '../../db.js';

export const DOCUMENT_LINK_TTL_SECONDS = 10 * 60;

/** Content sniffing for the allowed types. Null = not an allowed type. */
export function detectDocumentType(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 32));
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // HEIC/HEIF (iPhone photos): ISO-BMFF "ftyp" box with a HEIF brand.
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))
      return 'image/heic';
  }
  return null;
}

/** File names are shown to admins only; keep them short and harmless. */
export function safeFileName(name: string | undefined, type: NurseDocumentType): string {
  const cleaned = (name ?? '')
    .normalize('NFKC')
    .replace(/\p{Cc}/gu, '') // control characters
    .replace(/["\\/<>:|?*]/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || type;
}

/**
 * Stores (or replaces) one document of a type, atomically: the new file and row are written, and
 * the previous file of that type is deleted, in one transaction.
 */
export async function storeDocument(
  db: Db,
  input: {
    nurseId: string;
    type: NurseDocumentType;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    now: Date;
  },
) {
  const dbType = input.type.toUpperCase() as Uppercase<NurseDocumentType>;
  const storageKey = `nurse/${input.nurseId}/${input.type}/${randomBytes(12).toString('hex')}`;
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  return db.$transaction(async (tx) => {
    const previous = await tx.nurseDocument.findUnique({
      where: { nurseId_type: { nurseId: input.nurseId, type: dbType } },
    });
    await tx.nurseDocumentFile.create({
      data: { storageKey, bytes: new Uint8Array(input.bytes), createdAt: input.now },
    });
    const doc = await tx.nurseDocument.upsert({
      where: { nurseId_type: { nurseId: input.nurseId, type: dbType } },
      update: {
        storageKey,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.length,
        sha256,
        uploadedAt: input.now,
      },
      create: {
        nurseId: input.nurseId,
        type: dbType,
        storageKey,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.length,
        sha256,
        uploadedAt: input.now,
      },
    });
    if (previous)
      await tx.nurseDocumentFile.deleteMany({ where: { storageKey: previous.storageKey } });
    return doc;
  });
}

export async function deleteDocument(db: Db, doc: { id: string; storageKey: string }) {
  await db.$transaction([
    db.nurseDocument.delete({ where: { id: doc.id } }),
    db.nurseDocumentFile.deleteMany({ where: { storageKey: doc.storageKey } }),
  ]);
}

export async function readDocumentFile(db: Db, storageKey: string): Promise<Uint8Array | null> {
  const file = await db.nurseDocumentFile.findUnique({ where: { storageKey } });
  return file?.bytes ?? null;
}

// ---- Signed links ----

const linkKey = (jwtAccessSecret: string) =>
  createHmac('sha256', jwtAccessSecret).update('carelayer/document-link/v1').digest();

const signature = (secret: string, documentId: string, exp: number, adminId: string) =>
  createHmac('sha256', linkKey(secret)).update(`${documentId}.${exp}.${adminId}`).digest('hex');

/** Path + query of a short-lived link to one document, for one admin. */
export function signDocumentLink(
  secret: string,
  documentId: string,
  adminId: string,
  now: Date,
): string {
  const exp = Math.floor(now.getTime() / 1000) + DOCUMENT_LINK_TTL_SECONDS;
  const sig = signature(secret, documentId, exp, adminId);
  return `/files/nurse-documents/${encodeURIComponent(documentId)}?exp=${exp}&a=${encodeURIComponent(adminId)}&sig=${sig}`;
}

export type LinkCheck = 'ok' | 'expired' | 'invalid';

export function verifyDocumentLink(
  secret: string,
  documentId: string,
  q: { exp?: unknown; a?: unknown; sig?: unknown },
  now: Date,
): LinkCheck {
  if (typeof q.exp !== 'string' || typeof q.a !== 'string' || typeof q.sig !== 'string')
    return 'invalid';
  if (!/^\d{1,12}$/.test(q.exp) || !/^[0-9a-f]{64}$/.test(q.sig)) return 'invalid';
  const exp = Number(q.exp);
  const expected = Buffer.from(signature(secret, documentId, exp, q.a), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(q.sig, 'hex'))) return 'invalid';
  return exp * 1000 < now.getTime() ? 'expired' : 'ok';
}
