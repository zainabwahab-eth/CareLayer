import type { EmergencyContact, EmergencyResponse } from '@carelayer/shared';

/*
 * Router location state for W13 Emergency. The chat passes the
 * EmergencyResponse it just received, so the screen shows instantly with
 * no extra request. Opened without it (direct link, "Feeling very unwell?"),
 * the screen loads GET /emergency instead.
 */
export interface EmergencyLocationState {
  emergency: EmergencyResponse;
}

function isContact(value: unknown): value is EmergencyContact {
  if (!value || typeof value !== 'object') return false;
  const { label, number, verified } = value as Record<string, unknown>;
  return typeof label === 'string' && typeof number === 'string' && typeof verified === 'boolean';
}

/** Read and validate the state (history entries can hold anything). */
export function readEmergencyState(state: unknown): EmergencyResponse | null {
  if (!state || typeof state !== 'object') return null;
  const emergency = (state as Record<string, unknown>).emergency;
  if (!emergency || typeof emergency !== 'object') return null;
  const { kind, message, triggeredBy, contacts, findHospitalUrl } = emergency as Record<
    string,
    unknown
  >;
  if (
    kind !== 'emergency' ||
    typeof message !== 'string' ||
    !Array.isArray(triggeredBy) ||
    !Array.isArray(contacts) ||
    !contacts.every(isContact) ||
    typeof findHospitalUrl !== 'string'
  ) {
    return null;
  }
  return emergency as EmergencyResponse;
}

/** Only http(s) links open from the emergency screen. */
export function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** `tel:` href for a contact number: digits and a leading + only. */
export function telHref(number: string): string | undefined {
  const cleaned = number.replace(/[^\d+]/g, '');
  return /^\+?\d{2,15}$/.test(cleaned) ? `tel:${cleaned}` : undefined;
}
