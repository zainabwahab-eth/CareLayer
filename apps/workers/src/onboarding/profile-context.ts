import type { NurseProfile } from '@carelayer/shared';
import { createContext, useContext } from 'react';

export type ProfileState =
  | { status: 'loading'; profile: null; error: null }
  | { status: 'ready'; profile: NurseProfile; error: null }
  | { status: 'error'; profile: null; error: unknown };

export interface ProfileContextValue {
  state: ProfileState;
  /** Fetch GET /nurse/profile again (e.g. "Check again" on N04). */
  reload(): Promise<void>;
  /**
   * Store the profile a PATCH / submit returned, so screens never show stale data.
   * Pass a function to change the current one (e.g. add an uploaded document).
   */
  setProfile(next: NurseProfile | ((current: NurseProfile) => NurseProfile)): void;
}

export const ProfileContext = createContext<ProfileContextValue | null>(null);

export function useProfile(): ProfileContextValue {
  const value = useContext(ProfileContext);
  if (!value) throw new Error('useProfile must be used inside <ProfileProvider>');
  return value;
}

/** The loaded profile. Only for screens rendered behind <RequireProfile>. */
export function useReadyProfile() {
  const { state, ...rest } = useProfile();
  if (state.status !== 'ready') throw new Error('useReadyProfile needs a loaded profile');
  return { profile: state.profile, ...rest };
}
