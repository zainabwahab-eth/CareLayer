/** Router state for opening W06 with text in the composer (W05 topic chips). */
export interface AskPrefillState {
  prefill: string;
}

export function readAskPrefill(state: unknown): string | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const prefill = (state as Record<string, unknown>).prefill;
  return typeof prefill === 'string' ? prefill.slice(0, 200) : undefined;
}
