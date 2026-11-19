/*
 * "Continue with Google" (POST /auth/google needs a Google ID token).
 *
 * Mock builds: returns a stand-in token so the mock API can complete the flow.
 * Real builds: Google Identity Services is not wired up yet (it needs
 * VITE_GOOGLE_CLIENT_ID and Google's client script), so the button is hidden
 * rather than shown broken. When it lands, implement getIdToken here and the
 * screens need no changes.
 */
const IS_MOCK = import.meta.env.VITE_USE_MOCK_API === 'true';

export const googleSignIn = {
  available: IS_MOCK,
  async getIdToken(): Promise<string> {
    if (!IS_MOCK) throw new Error('Google sign-in is not available yet.');
    return 'mock-google-id-token';
  },
} as const;
