import type { NurseProfile } from '@carelayer/shared';
import { describe, expect, it } from 'vitest';
import { paths } from '../routes/paths';
import {
  checkDocumentFile,
  homePathFor,
  normaliseLicenceNumber,
  readMissing,
  validateLicenceForm,
  type LicenceForm,
} from './onboarding';

const valid: LicenceForm = {
  role: 'midwife',
  fullName: 'Amaka Okafor',
  fullNameConfirmed: true,
  licenceNumber: 'RM 123456',
  yearsOfPractice: '9',
  gender: null,
  topics: ['pregnancy'],
};

describe('validateLicenceForm (mirrors UpdateNurseProfileSchema)', () => {
  it('accepts a complete form; gender is optional', () => {
    expect(validateLicenceForm(valid)).toEqual({});
  });

  it('asks for every required field', () => {
    const errors = validateLicenceForm({
      role: null,
      fullName: ' ',
      fullNameConfirmed: false,
      licenceNumber: '',
      yearsOfPractice: '',
      gender: null,
      topics: [],
    });
    expect(Object.keys(errors).sort()).toEqual(
      [
        'fullName',
        'fullNameConfirmed',
        'licenceNumber',
        'role',
        'topics',
        'yearsOfPractice',
      ].sort(),
    );
  });

  it.each([
    ['A', 'Enter your full name as on your licence.'],
    ['x'.repeat(101), 'Use 100 characters or fewer.'],
  ])('full name %#', (fullName, message) => {
    expect(validateLicenceForm({ ...valid, fullName }).fullName).toBe(message);
  });

  it.each([
    ['RM', 'Enter your licence number.'],
    ['RM#123', 'Use letters, numbers, spaces, - or / only.'],
    ['R'.repeat(41), 'Use 40 characters or fewer.'],
  ])('licence number %#', (licenceNumber, message) => {
    expect(validateLicenceForm({ ...valid, licenceNumber }).licenceNumber).toBe(message);
  });

  it.each(['RM 123456', 'rn/2019-0042', 'A1 B2'])('allows licence format %s', (licenceNumber) => {
    expect(validateLicenceForm({ ...valid, licenceNumber }).licenceNumber).toBeUndefined();
  });

  it.each([
    ['9.5', 'Use whole years, like 9.'],
    ['-1', 'Use whole years, like 9.'],
    ['61', 'Enter a number from 0 to 60.'],
  ])('years of practice %s', (yearsOfPractice, message) => {
    expect(validateLicenceForm({ ...valid, yearsOfPractice }).yearsOfPractice).toBe(message);
  });

  it('allows 0 years (newly registered)', () => {
    expect(validateLicenceForm({ ...valid, yearsOfPractice: '0' })).toEqual({});
  });
});

describe('normaliseLicenceNumber', () => {
  it('matches how the server stores it', () => {
    expect(normaliseLicenceNumber('  rm   123456 ')).toBe('RM 123456');
  });
});

describe('checkDocumentFile', () => {
  const file = (size: number, name: string, type: string) =>
    new File([new Uint8Array(size)], name, { type });

  it('accepts PDFs and photos, including iPhone HEIC with no MIME type', () => {
    expect(checkDocumentFile(file(10, 'a.pdf', 'application/pdf'))).toBeUndefined();
    expect(checkDocumentFile(file(10, 'a.jpg', 'image/jpeg'))).toBeUndefined();
    expect(checkDocumentFile(file(10, 'IMG_0001.HEIC', ''))).toBeUndefined();
  });

  it('refuses empty, too large and other kinds of file', () => {
    expect(checkDocumentFile(file(0, 'a.pdf', 'application/pdf'))).toMatch(/empty/);
    expect(checkDocumentFile(file(10 * 1024 * 1024 + 1, 'a.pdf', 'application/pdf'))).toBe(
      'Files can be up to 10 MB.',
    );
    expect(checkDocumentFile(file(10, 'notes.docx', 'application/msword'))).toMatch(
      /PDF or a photo/,
    );
  });
});

describe('homePathFor', () => {
  const base = {
    role: 'nurse',
    fullNameConfirmed: true,
    licenceNumber: 'RN 1',
    yearsOfPractice: 3,
    topics: ['general'],
    documents: [],
    verificationStatus: 'draft',
  } as unknown as NurseProfile;
  const docs = [
    'practising_licence',
    'registration_certificate',
    'government_id',
    'selfie_with_id',
  ].map((type) => ({ id: type, type })) as unknown as NurseProfile['documents'];

  it('resumes onboarding at the first unfinished step', () => {
    expect(homePathFor({ ...base, role: null })).toBe(paths.licence);
    expect(homePathFor(base)).toBe(paths.documents);
    expect(homePathFor({ ...base, documents: docs })).toBe(paths.submit);
  });

  it('sends her to review, or Today once approved', () => {
    expect(homePathFor({ ...base, verificationStatus: 'pending_review' })).toBe(paths.review);
    expect(homePathFor({ ...base, verificationStatus: 'rejected' })).toBe(paths.review);
    expect(homePathFor({ ...base, verificationStatus: 'approved' })).toBe(paths.today);
  });
});

describe('readMissing', () => {
  it('keeps only known requirements from details.missing', () => {
    expect(readMissing({ missing: ['role', 'selfie_with_id', 'unknown', 3] })).toEqual([
      'role',
      'selfie_with_id',
    ]);
    expect(readMissing(undefined)).toEqual([]);
  });
});
