import {
  REQUIRED_SHARED_FIELDS,
  type EscalationOffer,
  type IsoDateTime,
  type NurseSelection,
  type NursePublicProfile,
  type QuestionDraft,
  type SharedField,
} from '@carelayer/shared';

/*
 * The W07-W09 "Send to a nurse" flow: what she reviewed on W07 and chose on W08,
 * kept in the chat store (memory only) until POST /questions succeeds. A new chat
 * message, a reset or a sign-out clears it, so a stale draft is never sent.
 */

/** Version of the W07 consent text. Recorded with every question (contract §8.1). */
export const CONSENT_VERSION = 'w07-v1';

export interface AskRequest {
  /** From POST /chat/draft: exactly what the nurse will receive. */
  draft: QuestionDraft;
  draftToken: string;
  draftExpiresAt: IsoDateTime;
  offer: EscalationOffer;
  /**
   * Her question as she edited it on W07 ("Edit" > Save). The draft was made from this
   * text alone, so a fresh draft (e.g. after it expires) is made from it too.
   */
  editedText?: string;
  /** She ticked "I agree to share this" on W07. */
  consented: boolean;
  nurseSelection: NurseSelection;
  /** Set when nurseSelection is "chosen_nurse". */
  chosenNurse: NursePublicProfile | null;
  femaleOnly: boolean;
}

/**
 * The fields W07 shows her, so the ones she agrees to share. Never her name, email,
 * phone or location (those are not in a draft at all).
 */
export function sharedFieldsFor(draft: QuestionDraft): SharedField[] {
  const fields: SharedField[] = [...REQUIRED_SHARED_FIELDS];
  if (draft.assistantNotes) fields.push('assistant_notes');
  if (draft.ageRange) fields.push('age_range');
  if (draft.pregnancyWeeks != null) fields.push('pregnancy_weeks');
  return fields;
}

/** A draft token is refused after it expires: W07 asks for a fresh one. */
export function isDraftExpired(request: AskRequest, now = Date.now()): boolean {
  return Date.parse(request.draftExpiresAt) <= now;
}
