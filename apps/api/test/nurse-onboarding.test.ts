// Z9: nurse onboarding, documents (Postgres storage), admin verification, signed document links.
import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { placeholderPdf } from '../src/seed/seed.js';
import { buildTestApp, fakeClock, memoryEmailSender } from './helpers/app.js';
import { testDatabaseUrl } from './helpers/env.js';
import { ensureTopics } from './helpers/people.js';

const db = createDb(testDatabaseUrl());
beforeAll(() => ensureTopics(db));
afterAll(() => db.$disconnect());

const MINUTE = 60_000;
const PDF = placeholderPdf('Practising licence');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypheic'),
  Buffer.alloc(64),
]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);

let clock: ReturnType<typeof fakeClock>;
let mail: ReturnType<typeof memoryEmailSender>;
let app: ReturnType<typeof buildTestApp>;
beforeEach(() => {
  clock = fakeClock(new Date());
  mail = memoryEmailSender();
  app = buildTestApp(db, { clock, emailSender: mail });
});

async function signUp(appName: 'nurses' | 'women' = 'nurses', name = 'Ngozi Adeyemi') {
  const email = `z9-${randomUUID().slice(0, 8)}@example.com`;
  await request(app)
    .post('/auth/code/request')
    .send({ email, purpose: 'signup', app: appName, name });
  const res = await request(app)
    .post('/auth/code/verify')
    .send({ email, code: mail.lastCode(email), purpose: 'signup', app: appName, name });
  return { email, userId: res.body.user.id as string, token: res.body.accessToken as string };
}

async function signInAdmin() {
  const email = `admin-${randomUUID().slice(0, 8)}@example.com`;
  await db.user.create({ data: { role: 'ADMIN', email, displayName: 'Admin' } });
  await request(app).post('/auth/code/request').send({ email, purpose: 'login', app: 'admin' });
  const res = await request(app)
    .post('/auth/code/verify')
    .send({ email, code: mail.lastCode(email), purpose: 'login', app: 'admin' });
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

const as = (token: string) => ({
  get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${token}`),
  patch: (p: string, b: object) =>
    request(app).patch(p).set('Authorization', `Bearer ${token}`).send(b),
  post: (p: string, b?: object) =>
    request(app)
      .post(p)
      .set('Authorization', `Bearer ${token}`)
      .send(b ?? {}),
  put: (p: string, b: object) =>
    request(app).put(p).set('Authorization', `Bearer ${token}`).send(b),
  del: (p: string) => request(app).delete(p).set('Authorization', `Bearer ${token}`),
  upload: (type: string, bytes: Buffer, name = 'file.pdf') =>
    request(app)
      .post('/nurse/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('type', type)
      .attach('file', bytes, name),
});

const licence = () => `RM-${randomUUID().slice(0, 8).toUpperCase()}`;

/** A nurse with every onboarding step done (not submitted). */
async function readyNurse() {
  const n = await signUp();
  const api = as(n.token);
  await api.patch('/nurse/profile', {
    role: 'midwife',
    fullNameConfirmed: true,
    yearsOfPractice: 7,
    licenceNumber: licence(),
    guidanceNotDiagnosisAccepted: true,
    languages: ['english', 'yoruba'],
    bio: 'Midwife in Ibadan.',
  });
  for (const t of ['practising_licence', 'registration_certificate', 'government_id']) {
    expect((await api.upload(t, PDF)).status).toBe(201);
  }
  expect((await api.upload('selfie_with_id', JPEG, 'me.jpg')).status).toBe(201);
  return { ...n, api };
}

describe('nurse profile', () => {
  it('a new nurse starts as a draft with her sign-up name and her custodial wallet', async () => {
    const n = await signUp();
    const res = await as(n.token).get('/nurse/profile');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: n.userId,
      fullName: 'Ngozi Adeyemi',
      role: null,
      verificationStatus: 'draft',
      documents: [],
      topics: [],
      available: false,
      guidanceNotDiagnosisAccepted: false,
      helpful: { percent: null, count: 0 },
    });
    expect(res.body.custodialStellarAddress).toMatch(/^G[A-Z2-7]{55}$/);
  });

  it('PATCH saves the onboarding fields; topics default from the role the first time', async () => {
    const n = await signUp();
    const res = await as(n.token).patch('/nurse/profile', {
      role: 'midwife',
      fullName: 'Ngozi A. Adeyemi',
      fullNameConfirmed: true,
      gender: 'female',
      practiceArea: 'Antenatal care',
      yearsOfPractice: 7,
      bio: 'Midwife in Ibadan.',
      languages: ['english', 'yoruba'],
      licenceNumber: ' rm 12345 ',
      guidanceNotDiagnosisAccepted: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      role: 'midwife',
      fullName: 'Ngozi A. Adeyemi',
      gender: 'female',
      licenceNumber: 'RM 12345',
      topics: ['pregnancy', 'periods'],
      guidanceNotDiagnosisAccepted: true,
    });
    // Her name as on the licence is her display name too.
    expect((await as(n.token).get('/me')).body.displayName).toBe('Ngozi A. Adeyemi');
    // Changing the role later does not reset topics she chose.
    await as(n.token).patch('/nurse/preferences', { topics: ['general'] });
    expect((await as(n.token).patch('/nurse/profile', { role: 'nurse' })).body.topics).toEqual([
      'general',
    ]);
  });

  it('a nurse role defaults to every topic', async () => {
    const n = await signUp();
    const res = await as(n.token).patch('/nurse/profile', { role: 'nurse' });
    expect(res.body.topics).toEqual([
      'pregnancy',
      'periods',
      'contraception',
      'sexual_health',
      'general',
    ]);
  });

  it.each([
    [{}, undefined],
    [{ role: 'doctor' }, 'role'],
    [{ bio: 'x'.repeat(281) }, 'bio'],
    [{ yearsOfPractice: 3.5 }, 'yearsOfPractice'],
    [{ languages: [] }, 'languages'],
    [{ languages: ['english', 'french'] }, 'languages.1'],
    [{ licenceNumber: 'RM<script>' }, 'licenceNumber'],
    [{ verificationStatus: 'approved' }, undefined],
  ])('rejects a bad PATCH %#', async (body, field) => {
    const n = await signUp();
    const res = await as(n.token).patch('/nurse/profile', body);
    expect(res.status).toBe(400);
    if (field) expect(res.body.error.details.field).toBe(field);
  });

  it('a licence number can belong to one nurse only', async () => {
    const a = await signUp();
    const b = await signUp();
    const lic = licence();
    expect((await as(a.token).patch('/nurse/profile', { licenceNumber: lic })).status).toBe(200);
    const dup = await as(b.token).patch('/nurse/profile', { licenceNumber: lic });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.field).toBe('licenceNumber');
  });

  it('women and admins cannot use /nurse/*', async () => {
    const w = await signUp('women', 'Tolu');
    expect((await as(w.token).get('/nurse/profile')).status).toBe(403);
    const admin = await signInAdmin();
    expect((await as(admin.token).get('/nurse/profile')).status).toBe(403);
  });
});

describe('preferences', () => {
  it('at least one topic is required', async () => {
    const n = await signUp();
    const res = await as(n.token).patch('/nurse/preferences', { topics: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'TOPICS_REQUIRED', details: { field: 'topics' } });
  });

  it('sets topics and the available toggle', async () => {
    const n = await signUp();
    const res = await as(n.token).patch('/nurse/preferences', {
      topics: ['general', 'periods'],
      available: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ topics: ['periods', 'general'], available: true });
  });
});

describe('documents', () => {
  it('stores a PDF, detecting its type from the bytes, and lists it without any URL', async () => {
    const n = await signUp();
    const res = await as(n.token).upload('practising_licence', PDF, 'my licence.pdf');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'practising_licence',
      fileName: 'my licence.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
    });
    const doc = await db.nurseDocument.findUniqueOrThrow({ where: { id: res.body.id } });
    const file = await db.nurseDocumentFile.findUniqueOrThrow({
      where: { storageKey: doc.storageKey },
    });
    expect(Buffer.from(file.bytes).equals(PDF)).toBe(true);
    const profile = await as(n.token).get('/nurse/profile');
    expect(JSON.stringify(profile.body)).not.toMatch(/storageKey|\/files\/|http/);
  });

  it('accepts JPEG, PNG and HEIC (iPhone) by content; refuses anything else whatever its name', async () => {
    const n = await signUp();
    const api = as(n.token);
    expect((await api.upload('government_id', JPEG, 'id.jpg')).body.mimeType).toBe('image/jpeg');
    expect((await api.upload('government_id', PNG, 'id.png')).body.mimeType).toBe('image/png');
    expect((await api.upload('selfie_with_id', HEIC, 'IMG_0001.HEIC')).body.mimeType).toBe(
      'image/heic',
    );
    const exe = await api.upload('government_id', EXE, 'id.pdf');
    expect(exe.status).toBe(400);
    expect(exe.body.error.details.field).toBe('file');
  });

  it('re-uploading a type replaces it and deletes the old file', async () => {
    const n = await signUp();
    const api = as(n.token);
    const first = await api.upload('government_id', PDF);
    const oldKey = (await db.nurseDocument.findUniqueOrThrow({ where: { id: first.body.id } }))
      .storageKey;
    const second = await api.upload('government_id', JPEG, 'id.jpg');
    expect(second.body.id).toBe(first.body.id); // one document per type
    expect(await db.nurseDocumentFile.findUnique({ where: { storageKey: oldKey } })).toBeNull();
    expect((await api.get('/nurse/profile')).body.documents).toHaveLength(1);
  });

  it('rejects files over 10 MB (413), a missing file, and an unknown type', async () => {
    const n = await signUp();
    const api = as(n.token);
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024)]);
    const tooBig = await api.upload('practising_licence', big);
    expect(tooBig.status).toBe(413);
    const noFile = await request(app)
      .post('/nurse/documents')
      .set('Authorization', `Bearer ${n.token}`)
      .field('type', 'practising_licence');
    expect(noFile.status).toBe(400);
    expect(noFile.body.error.details.field).toBe('file');
    const badType = await api.upload('passport', PDF);
    expect(badType.status).toBe(400);
    expect(badType.body.error.details.field).toBe('type');
  });

  it('DELETE removes the document and its file; someone else’s is 404', async () => {
    const n = await signUp();
    const other = await signUp();
    const up = await as(n.token).upload('government_id', PDF);
    expect((await as(other.token).del(`/nurse/documents/${up.body.id}`)).status).toBe(404);
    const key = (await db.nurseDocument.findUniqueOrThrow({ where: { id: up.body.id } }))
      .storageKey;
    expect((await as(n.token).del(`/nurse/documents/${up.body.id}`)).status).toBe(204);
    expect(await db.nurseDocumentFile.findUnique({ where: { storageKey: key } })).toBeNull();
  });
});

describe('submit for review', () => {
  it('lists exactly what is missing', async () => {
    const n = await signUp();
    await as(n.token).patch('/nurse/profile', { role: 'nurse', yearsOfPractice: 3 });
    await as(n.token).upload('practising_licence', PDF);
    const res = await as(n.token).post('/nurse/profile/submit');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'ONBOARDING_INCOMPLETE',
      details: {
        missing: [
          'fullNameConfirmed',
          'licenceNumber',
          'guidanceNotDiagnosisAccepted',
          'registration_certificate',
          'government_id',
          'selfie_with_id',
        ],
      },
    });
  });

  it('a complete profile goes to pending review; submitting again is harmless', async () => {
    const n = await readyNurse();
    const res = await n.api.post('/nurse/profile/submit');
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('pending_review');
    expect((await n.api.post('/nurse/profile/submit')).body.verificationStatus).toBe(
      'pending_review',
    );
  });

  it('licence details and documents are locked while under review', async () => {
    const n = await readyNurse();
    await n.api.post('/nurse/profile/submit');
    const lic = await n.api.patch('/nurse/profile', { licenceNumber: licence() });
    expect(lic.status).toBe(409);
    expect(lic.body.error.details.field).toBe('licenceNumber');
    expect((await n.api.patch('/nurse/profile', { bio: 'Updated bio.' })).status).toBe(200); // not reviewed
    expect((await n.api.upload('government_id', PDF)).status).toBe(409);
    const docId = (await n.api.get('/nurse/profile')).body.documents[0].id;
    expect((await n.api.del(`/nurse/documents/${docId}`)).status).toBe(409);
  });
});

describe('unapproved nurses cannot see questions', () => {
  it('/nurse/questions and /nurse/claim answer 403 NURSE_NOT_APPROVED until approved', async () => {
    const n = await readyNurse();
    for (const path of ['/nurse/questions', '/nurse/questions/abc', '/nurse/claim']) {
      const res = await n.api.get(path);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NURSE_NOT_APPROVED');
    }
    await n.api.post('/nurse/profile/submit');
    expect((await n.api.get('/nurse/questions')).body.error.code).toBe('NURSE_NOT_APPROVED');
    const admin = await signInAdmin();
    await as(admin.token).post(`/admin/nurses/${n.userId}/approve`);
    // Approved: past the guard (Z7 built the route).
    expect((await n.api.get('/nurse/questions')).status).toBe(200);
  });
});

describe('admin verification', () => {
  it('lists pending nurses oldest first, with cursor pages', async () => {
    const admin = await signInAdmin();
    await db.nurseProfile.updateMany({
      where: { verificationStatus: 'PENDING_REVIEW' },
      data: { verificationStatus: 'DRAFT' },
    });
    const a = await readyNurse();
    clock.advance(1000);
    const b = await readyNurse();
    await a.api.post('/nurse/profile/submit');
    await b.api.post('/nurse/profile/submit');
    const page1 = await as(admin.token).get('/admin/nurses?limit=1');
    expect(page1.status).toBe(200);
    expect(page1.body.items).toEqual([
      expect.objectContaining({
        userId: a.userId,
        verificationStatus: 'pending_review',
        role: 'midwife',
      }),
    ]);
    const page2 = await as(admin.token).get(
      `/admin/nurses?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
    );
    expect(page2.body.items.map((x: { userId: string }) => x.userId)).toEqual([b.userId]);
    expect((await as(admin.token).get('/admin/nurses?status=bogus')).status).toBe(400);
  });

  it('detail has the email and a signed link per document that serves the exact file', async () => {
    const admin = await signInAdmin();
    const n = await readyNurse();
    await n.api.post('/nurse/profile/submit');
    const res = await as(admin.token).get(`/admin/nurses/${n.userId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: n.userId,
      email: n.email,
      verificationStatus: 'pending_review',
    });
    expect(res.body.documents).toHaveLength(4);
    const licenceDoc = res.body.documents.find(
      (d: { type: string }) => d.type === 'practising_licence',
    );
    const url: string = res.body.documentUrls[licenceDoc.id];
    expect(url).toMatch(/^\/files\/nurse-documents\/.+\?exp=\d+&a=.+&sig=[0-9a-f]{64}$/);

    const file = await request(app)
      .get(url)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect(Buffer.from(file.body as Buffer).equals(PDF)).toBe(true);
  });

  it('documents are not publicly reachable: no link, a tampered link, another document, or an expired link all fail', async () => {
    const admin = await signInAdmin();
    const n = await readyNurse();
    const detail = (await as(admin.token).get(`/admin/nurses/${n.userId}`)).body;
    const [d1, d2] = detail.documents as { id: string }[];
    const url: string = detail.documentUrls[d1!.id];

    expect((await request(app).get(`/files/nurse-documents/${d1!.id}`)).status).toBe(403);
    expect(
      (await request(app).get(url.slice(0, -1) + (url.endsWith('0') ? '1' : '0'))).status,
    ).toBe(403);
    expect((await request(app).get(url.replace(d1!.id, d2!.id))).status).toBe(403);
    expect((await request(app).get(url.replace(/exp=\d+/, 'exp=9999999999'))).status).toBe(403);
    // Bearer tokens do not open files either: only the signed link does.
    expect((await as(n.token).get(`/files/nurse-documents/${d1!.id}`)).status).toBe(403);

    clock.advance(10 * MINUTE + 1000);
    const expired = await request(app).get(url);
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('LINK_EXPIRED');
  });

  it('approve: pending -> approved, emails her, and only once', async () => {
    const admin = await signInAdmin();
    const n = await readyNurse();
    await n.api.post('/nurse/profile/submit');
    const res = await as(admin.token).post(`/admin/nurses/${n.userId}/approve`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: n.userId, verificationStatus: 'approved' });
    const row = await db.nurseProfile.findUniqueOrThrow({ where: { userId: n.userId } });
    expect(row).toMatchObject({ reviewedById: admin.userId, rejectionReason: null });
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.reviews).toEqual([
      expect.objectContaining({ to: n.email, approved: true, reason: null }),
    ]);
    const again = await as(admin.token).post(`/admin/nurses/${n.userId}/approve`);
    expect(again.status).toBe(409);
    // Approved licence details are locked.
    expect((await n.api.patch('/nurse/profile', { role: 'nurse' })).status).toBe(409);
  });

  it('two admins deciding at once: exactly one wins', async () => {
    const a1 = await signInAdmin();
    const a2 = await signInAdmin();
    const n = await readyNurse();
    await n.api.post('/nurse/profile/submit');
    const [r1, r2] = await Promise.all([
      as(a1.token).post(`/admin/nurses/${n.userId}/approve`),
      as(a2.token).post(`/admin/nurses/${n.userId}/reject`, { reason: 'Licence photo is blurry.' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });

  it('reject: needs a reason; she sees it, can fix and resubmit', async () => {
    const admin = await signInAdmin();
    const n = await readyNurse();
    await n.api.post('/nurse/profile/submit');
    expect((await as(admin.token).post(`/admin/nurses/${n.userId}/reject`, {})).status).toBe(400);
    const res = await as(admin.token).post(`/admin/nurses/${n.userId}/reject`, {
      reason: 'The licence photo is blurry. Upload a clearer one.',
    });
    expect(res.status).toBe(200);
    const profile = (await n.api.get('/nurse/profile')).body;
    expect(profile).toMatchObject({
      verificationStatus: 'rejected',
      rejectionReason: 'The licence photo is blurry. Upload a clearer one.',
      available: false,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.reviews[0]).toMatchObject({
      approved: false,
      reason: expect.stringContaining('blurry'),
    });
    // Rejected: she can change documents again and resubmit.
    expect((await n.api.upload('practising_licence', JPEG, 'clear.jpg')).status).toBe(201);
    const resubmit = await n.api.post('/nurse/profile/submit');
    expect(resubmit.body).toMatchObject({
      verificationStatus: 'pending_review',
      rejectionReason: null,
    });
  });

  it('only admins; unknown nurse is 404', async () => {
    const n = await signUp();
    expect((await as(n.token).get('/admin/nurses')).status).toBe(403);
    const admin = await signInAdmin();
    expect((await as(admin.token).post('/admin/nurses/nope/approve')).status).toBe(404);
    expect((await as(admin.token).get('/admin/nurses/nope')).status).toBe(404);
  });
});

describe('payout address', () => {
  it('needs a fresh code, a valid Stellar address, and null goes back to the custodial wallet', async () => {
    const n = await signUp();
    const addr = Keypair.random().publicKey();
    const stale = await as(n.token).put('/nurse/payout-address', { stellarAddress: addr });
    expect(stale.status).toBe(403);
    expect(stale.body.error.code).toBe('STEP_UP_REQUIRED');

    await as(n.token).post('/auth/code/request', {
      email: n.email,
      purpose: 'step_up',
      app: 'nurses',
    });
    expect((await as(n.token).post('/auth/step-up', { code: mail.lastCode(n.email) })).status).toBe(
      200,
    );

    const bad = await as(n.token).put('/nurse/payout-address', { stellarAddress: 'GNOTREAL' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('STELLAR_ADDRESS_INVALID');
    expect(
      (await as(n.token).put('/nurse/payout-address', { stellarAddress: addr })).body
        .ownStellarAddress,
    ).toBe(addr);
    expect(
      (await as(n.token).put('/nurse/payout-address', { stellarAddress: null })).body
        .ownStellarAddress,
    ).toBeNull();
  });
});

describe('admin console page', () => {
  it('is served with a nonce CSP and contains no data', async () => {
    const res = await request(app).get('/admin-console');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const csp = res.headers['content-security-policy'] as string;
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(res.text).toContain(`<script nonce="${nonce}">`);
    expect(res.text).not.toContain('innerHTML');
    expect(res.text).not.toMatch(/@example\.com|RM-/);
  });
});
