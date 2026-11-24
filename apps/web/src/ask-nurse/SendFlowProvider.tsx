import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  INITIAL_SEND_FLOW,
  SendFlowContext,
  type NurseChoice,
  type PreparedDraft,
  type SendFlowContextValue,
  type SendFlowState,
} from './send-flow';

/**
 * Holds the "Send to a nurse" steps above the router, so W07-W09 share one
 * draft. Memory only, and reset whenever the signed-in user changes.
 */
export function SendFlowProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  return <SendFlowStore key={state.user?.id ?? 'signed-out'}>{children}</SendFlowStore>;
}

function SendFlowStore({ children }: { children: ReactNode }) {
  const [flow, setFlow] = useState<SendFlowState>(INITIAL_SEND_FLOW);

  const setDraft = useCallback(
    (threadKey: string, draft: PreparedDraft) =>
      setFlow((current) => ({
        ...INITIAL_SEND_FLOW,
        femaleOnly: current.femaleOnly,
        prepared: { threadKey, draft },
      })),
    [],
  );
  const clearDraft = useCallback(
    () => setFlow((current) => ({ ...current, prepared: null, consented: false })),
    [],
  );
  const giveConsent = useCallback(
    () => setFlow((current) => ({ ...current, consented: true })),
    [],
  );
  const choose = useCallback(
    (choice: NurseChoice) => setFlow((current) => ({ ...current, choice })),
    [],
  );
  const setFemaleOnly = useCallback(
    (femaleOnly: boolean) => setFlow((current) => ({ ...current, femaleOnly })),
    [],
  );
  const finish = useCallback(
    (to: string, state?: unknown) =>
      setFlow((current) => ({
        ...INITIAL_SEND_FLOW,
        femaleOnly: current.femaleOnly,
        finished: { to, state },
      })),
    [],
  );
  const reset = useCallback(() => setFlow(INITIAL_SEND_FLOW), []);

  const value = useMemo<SendFlowContextValue>(
    () => ({ ...flow, setDraft, clearDraft, giveConsent, choose, setFemaleOnly, finish, reset }),
    [flow, setDraft, clearDraft, giveConsent, choose, setFemaleOnly, finish, reset],
  );

  return <SendFlowContext.Provider value={value}>{children}</SendFlowContext.Provider>;
}
