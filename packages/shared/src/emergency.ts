// Emergency responses. Always free, never queued. See docs/API_CONTRACT.md §6.

export interface EmergencyContact {
  label: string;
  /** E.164 or short code. MUST be verified before the demo. */
  number: string;
  verified: boolean;
}

export interface EmergencyResponse {
  kind: 'emergency';
  /** Plain-language message shown immediately. */
  message: string;
  /** Which red flags triggered (ids from apps/api/config/red-flags.json, or "llm"). */
  triggeredBy: string[];
  contacts: EmergencyContact[];
  /** Link that opens a map search for nearby hospitals. */
  findHospitalUrl: string;
}
