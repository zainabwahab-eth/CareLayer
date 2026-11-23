import { describe, expect, it } from 'vitest';
import { JPEG_BYTES, pdfFile, signIn, testApi } from '../test/render-app';
import { detectDocumentType } from './mock-api';

const expectApiError = async (promise: Promise<unknown>, status: number, code: string) => {
  await expect(promise).rejects.toMatchObject({ status, code });
};

describe('mock nurse API (follows apps/api Z9 rules)', () => {
  it('sign-up creates a draft profile with her licence name', async () => {
    const api = testApi();
    await signIn(api, 'ngozi@example.com', 'Ngozi Eze');
    const profile = await api.nurse.getProfile();
    expect(profile).toMatchObject({
      fullName: 'Ngozi Eze',
      verificationStatus: 'draft',
      topics: [],
    });
  });

  it('refuses the women app and existing accounts', async () => {
    const api = testApi();
    await expectApiError(
      api.auth.requestCode({ email: 'a@b.co', purpose: 'login', app: 'women' }),
      403,
      'WRONG_APP',
    );
    await expectApiError(
      api.auth.requestCode({
        email: 'amaka@example.com',
        purpose: 'signup',
        app: 'nurses',
        name: 'A B',
      }),
      409,
      'ACCOUNT_EXISTS',
    );
  });

  it('defaults topics from the first role, and refuses empty topics', async () => {
    const api = testApi();
    await signIn(api, 'new@example.com', 'New Nurse');
    expect((await api.nurse.updateProfile({ role: 'midwife' })).topics).toEqual([
      'pregnancy',
      'periods',
    ]);
    await expectApiError(api.nurse.updatePreferences({ topics: [] }), 400, 'TOPICS_REQUIRED');
  });

  it('validates fields with details.field and normalises licence numbers', async () => {
    const api = testApi();
    await signIn(api, 'new@example.com', 'New Nurse');
    await expect(api.nurse.updateProfile({ licenceNumber: 'RM#1' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'licenceNumber' },
    });
    expect((await api.nurse.updateProfile({ licenceNumber: ' rm  77 ' })).licenceNumber).toBe(
      'RM 77',
    );
  });

  it('licence numbers are unique', async () => {
    const api = testApi();
    await signIn(api, 'new@example.com', 'New Nurse');
    await expect(api.nurse.updateProfile({ licenceNumber: 'RM 000001' })).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { field: 'licenceNumber' },
    });
  });

  it('sniffs the real file type and enforces 10 MB', async () => {
    expect(await detectDocumentType(new Blob([JPEG_BYTES]))).toBe('image/jpeg');
    const api = testApi();
    await signIn(api, 'new@example.com', 'New Nurse');
    const fake = new File(['just text'], 'licence.pdf', { type: 'application/pdf' });
    await expect(api.nurse.uploadDocument('practising_licence', fake)).rejects.toMatchObject({
      details: { field: 'file' },
    });
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf');
    await expectApiError(
      api.nurse.uploadDocument('practising_licence', big),
      413,
      'VALIDATION_FAILED',
    );
  });

  it('submit lists what is missing, then succeeds and locks licence fields', async () => {
    const api = testApi();
    await signIn(api, 'new@example.com', 'New Nurse');
    await expect(api.nurse.submit()).rejects.toMatchObject({
      code: 'ONBOARDING_INCOMPLETE',
      details: {
        missing: expect.arrayContaining(['role', 'selfie_with_id', 'guidanceNotDiagnosisAccepted']),
      },
    });

    await api.nurse.updateProfile({
      role: 'nurse',
      fullNameConfirmed: true,
      licenceNumber: 'RN 1234',
      yearsOfPractice: 4,
      guidanceNotDiagnosisAccepted: true,
    });
    for (const type of [
      'practising_licence',
      'registration_certificate',
      'government_id',
      'selfie_with_id',
    ] as const) {
      await api.nurse.uploadDocument(type, pdfFile());
    }
    expect((await api.nurse.submit()).verificationStatus).toBe('pending_review');

    await expect(api.nurse.updateProfile({ licenceNumber: 'RN 9' })).rejects.toMatchObject({
      status: 409,
      details: { field: 'licenceNumber' },
    });
    await expectApiError(api.nurse.uploadDocument('government_id', pdfFile()), 409, 'CONFLICT');
    // Not a licence field: still editable while under review.
    expect((await api.nurse.updateProfile({ yearsOfPractice: 5 })).yearsOfPractice).toBe(5);
  });
});
