/*
 * Router state for opening the Ask screen (W06):
 *   newChat - start a blank chat instead of carrying on the open one
 *             ("Ask a question", "Ask again", topic chips…)
 *   prefill - start the composer with a few words to finish (W05 topic chips)
 * The Ask tab itself passes nothing, so it returns to the chat she was in.
 */
export interface AskRouteState {
  newChat?: boolean;
  prefill?: string;
}

/** Pass as `state` on a link to paths.ask to start a new chat. */
export const NEW_CHAT_STATE: AskRouteState = { newChat: true };

export function readAskRouteState(state: unknown): AskRouteState {
  if (!state || typeof state !== 'object') return {};
  const { newChat, prefill } = state as Record<string, unknown>;
  return {
    newChat: newChat === true || undefined,
    prefill: typeof prefill === 'string' ? prefill.slice(0, 200) : undefined,
  };
}
