// The emergency pathway: free, never queued, the same response everywhere (contract §6).
// Logged as EmergencyEvent with source + timestamp ONLY: no user, no text, no red-flag id.
import type { EmergencyContact, EmergencyResponse } from '@carelayer/shared';
import type { Db } from '../../db.js';
import type { Logger } from '../../lib/logger.js';

/**
 * Numbers stay `verified: false` until a person has called them and signed off (docs/QUESTIONS.md
 * Q2). The web app never shows an unverified number as the main "Call" button.
 * 112: Nigeria's national emergency number (NCC). Unverified for this app until checked.
 */
export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  { label: 'National emergency number', number: '112', verified: false },
];

/** Opens a map search on her own device. CareLayer never sees or stores her location. */
export const FIND_HOSPITAL_URL = 'https://www.google.com/maps/search/?api=1&query=hospital';

export const EMERGENCY_MESSAGE =
  'What you describe may need urgent care. Please get help now: call emergency services or go to ' +
  'the nearest hospital or clinic. If you can, ask someone to go with you. This is free, and ' +
  'nothing has been sent anywhere.';

export function emergencyResponse(triggeredBy: string[]): EmergencyResponse {
  return {
    kind: 'emergency',
    message: EMERGENCY_MESSAGE,
    triggeredBy,
    contacts: EMERGENCY_CONTACTS.map((c) => ({ ...c })),
    findHospitalUrl: FIND_HOSPITAL_URL,
  };
}

export type EmergencySourceName = 'CHAT' | 'QUESTION' | 'MCP';

/**
 * Records the event and returns the response. A failed write is logged, never shown: she must get
 * the emergency screen even if the database is down.
 */
export async function recordEmergency(
  deps: { db: Db; logger: Logger },
  source: EmergencySourceName,
  triggeredBy: string[],
): Promise<EmergencyResponse> {
  try {
    await deps.db.emergencyEvent.create({ data: { source } });
  } catch (err) {
    deps.logger.error('emergency_event_write_failed', { source, error: (err as Error).message });
  }
  // Trace: which layer caught it (fixed list vs llm), never what she wrote or who she is.
  deps.logger.info('emergency', {
    source,
    layer: triggeredBy.includes('llm') ? (triggeredBy.length > 1 ? 'both' : 'llm') : 'fixed_list',
  });
  return emergencyResponse(triggeredBy);
}
