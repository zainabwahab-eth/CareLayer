import type {
  AuthTokensResponse,
  GoogleAuthBody,
  Id,
  NurseDocument,
  NurseDocumentType,
  NurseProfile,
  RequestCodeBody,
  RequestCodeResponse,
  UpdateNursePreferencesBody,
  UpdateNurseProfileBody,
  VerifyCodeBody,
} from '@carelayer/shared';

/*
 * The nurse app's view of the CareLayer API (docs/API_CONTRACT.md §2 and §10).
 * Screens depend only on this interface. Two implementations, as in apps/web:
 *   - mock-api.ts  in-browser mock (VITE_USE_MOCK_API=true)
 *   - http-api.ts  fetch client for apps/api
 * Every type comes from @carelayer/shared. Every method rejects with ApiError.
 *
 * Covered: auth and onboarding (H9 application). Not yet: dashboard, cases,
 * earnings, payout address (the rest of H9).
 */
export interface NurseApi {
  readonly mode: 'mock' | 'http';

  auth: {
    /** POST /auth/code/request (app "nurses") */
    requestCode(body: RequestCodeBody): Promise<RequestCodeResponse>;
    /** POST /auth/code/verify */
    verifyCode(body: VerifyCodeBody): Promise<AuthTokensResponse>;
    /** POST /auth/google */
    signInWithGoogle(body: GoogleAuthBody): Promise<AuthTokensResponse>;
    /** POST /auth/refresh: restores the session from the refresh cookie. */
    refresh(): Promise<AuthTokensResponse>;
    /** POST /auth/logout */
    logout(): Promise<void>;
  };

  nurse: {
    /** GET /nurse/profile */
    getProfile(): Promise<NurseProfile>;
    /** PATCH /nurse/profile */
    updateProfile(body: UpdateNurseProfileBody): Promise<NurseProfile>;
    /** PATCH /nurse/preferences (topics, available) */
    updatePreferences(body: UpdateNursePreferencesBody): Promise<NurseProfile>;
    /** POST /nurse/documents (multipart: type, file). Re-uploading a type replaces it. */
    uploadDocument(type: NurseDocumentType, file: File): Promise<NurseDocument>;
    /** DELETE /nurse/documents/:id */
    removeDocument(id: Id): Promise<void>;
    /** POST /nurse/profile/submit: send for review. */
    submit(): Promise<NurseProfile>;
  };

  /**
   * Mock builds only: stand-in for the admin's decision (GET /admin-console in
   * the real API), so N04's approved and rejected states can be tried.
   */
  readonly mockAdmin?: {
    approve(): Promise<void>;
    reject(reason: string): Promise<void>;
  };
}
