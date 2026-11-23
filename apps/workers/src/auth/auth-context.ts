import type { AuthTokensResponse, User } from '@carelayer/shared';
import { createContext } from 'react';

export type SignedOutReason = 'none' | 'logout' | 'expired';

export type AuthState =
  | { status: 'loading'; user: null; reason: 'none' }
  | { status: 'authenticated'; user: User; reason: 'none' }
  | { status: 'unauthenticated'; user: null; reason: SignedOutReason };

export interface AuthContextValue {
  state: AuthState;
  /** Call with the response of verifyCode / signInWithGoogle. */
  completeSignIn(tokens: AuthTokensResponse): void;
  /** Ends the session on the server (best effort) and here. Never rejects. */
  logout(): Promise<void>;
  /** An authenticated request failed because the session is gone. */
  sessionExpired(): void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
