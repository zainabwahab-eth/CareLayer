// Google sign-in: verify the ID token the frontend got from Google Identity Services.
import { OAuth2Client } from 'google-auth-library';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | undefined;
}

export interface GoogleVerifier {
  /** Resolves the identity, or null if the token is invalid, expired or for another client. */
  verify(idToken: string): Promise<GoogleIdentity | null>;
}

export function createGoogleVerifier(clientId: string): GoogleVerifier {
  const client = new OAuth2Client(clientId);
  return {
    async verify(idToken) {
      try {
        const ticket = await client.verifyIdToken({ idToken, audience: clientId });
        const p = ticket.getPayload();
        if (!p?.sub || !p.email) return null;
        return {
          sub: p.sub,
          email: p.email.toLowerCase(),
          emailVerified: p.email_verified === true,
          name: p.name,
        };
      } catch {
        return null;
      }
    },
  };
}
