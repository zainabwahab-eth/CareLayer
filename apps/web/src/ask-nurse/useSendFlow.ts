import { useContext } from 'react';
import { SendFlowContext, type SendFlowContextValue } from './send-flow';

/** The current "Send to a nurse" steps (W07-W09). Must be used inside <SendFlowProvider>. */
export function useSendFlow(): SendFlowContextValue {
  const flow = useContext(SendFlowContext);
  if (!flow) throw new Error('useSendFlow must be used inside <SendFlowProvider>');
  return flow;
}
