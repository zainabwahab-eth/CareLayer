import type { AuthTokensResponse, User } from '@carelayer/shared';
import { createContext } from 'react';

/** Why she is signed out. Decides where the route guard sends her. */
export type SignedOutReason = 'none' | 'logout' | 'expired';

export type AuthState =
  | { status: 'loading'; user: null; reason: 'none' }
  | { status: 'authenticated'; user: User; reason: 'none' }
  | { status: 'unauthenticated'; user: null; reason: SignedOutReason };

export interface AuthContextValue {
  state: AuthState;
  /** Call with the response of verifyCode / signInWithGoogle. */
  completeSignIn(tokens: AuthTokensResponse): void;
  /** Ends the session on the server (best effort) and locally. Never rejects. */
  logout(): Promise<void>;
  /**
   * Ends every session on the server, then signs out here. Rejects (and stays
   * signed in) if the server did not confirm, so she is never told "done" when it wasn't.
   */
  logoutAll(): Promise<void>;
  /** Replace the signed-in user after PATCH /me. */
  updateUser(user: User): void;
  /** An authenticated request failed because the session is gone. */
  sessionExpired(): void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
