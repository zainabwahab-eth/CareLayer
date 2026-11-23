import { createContext, useContext } from 'react';
import type { NurseApi } from './types';

export const NurseApiContext = createContext<NurseApi | null>(null);

/** The nurse API from <NurseApiProvider>. */
export function useNurseApi(): NurseApi {
  const api = useContext(NurseApiContext);
  if (!api) throw new Error('useNurseApi must be used inside <NurseApiProvider>');
  return api;
}
