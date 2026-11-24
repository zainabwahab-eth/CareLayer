import {
  REQUIRED_SHARED_FIELDS,
  type ChatTurn,
  type DraftResponse,
  type NursePublicProfile,
  type QuestionDraft,
  type SharedField,
} from '@carelayer/shared';
import { createContext } from 'react';

/*
 * State for "Send to a nurse" (W07 Consent -> W08 Choose who answers -> W09 Confirm and send).
 *
 * Memory only, like the chat it comes from: a reload, logging out or quick exit
 * forgets it, and nothing about her question is written to storage. It is
 * cleared once POST /questions succeeds, so going Back can never send twice.
 */

/** A draft from POST /chat/draft: exactly what a nurse will see, with its signed token. */
export type PreparedDraft = Extract<DraftResponse, { kind: 'draft' }>;

/**
 * Version of the W07 consent wording. Stored with each question (contract §8.1,
 * `consent.consentVersion`). Change it whenever the consent text on W07 changes.
 */
export const CONSENT_VERSION = 'web-w07-2026-11';

/** W08: "First available" (default) or one nurse from GET /nurses. */
export type NurseChoice =
  { kind: 'first_available' } | { kind: 'chosen_nurse'; nurse: NursePublicProfile };

export const FIRST_AVAILABLE: NurseChoice = { kind: 'first_available' };

export interface SendFlowState {
  /** The draft she is reviewing, and the chat thread it was made from. */
  prepared: { threadKey: string; draft: PreparedDraft } | null;
  /** She ticked "I agree to share this" on W07 for this draft. */
  consented: boolean;
  choice: NurseChoice;
  /** "Only female health workers" (W08). */
  femaleOnly: boolean;
  /**
   * Set once POST /questions has answered: where she goes next (W10, or W13 for an
   * emergency). The draft is cleared in the same update, and W08/W09 send her here
   * instead of back to W07, so the route change and the clean-up can land in any order
   * and Back can never reach a screen that would send the question again.
   */
  finished: { to: string; state?: unknown } | null;
}

export interface SendFlowContextValue extends SendFlowState {
  /** Keep a new draft. Consent and the nurse choice start again: they were for the old one. */
  setDraft(threadKey: string, draft: PreparedDraft): void;
  /** Forget the draft (e.g. its token expired), so W07 asks for a fresh one. */
  clearDraft(): void;
  giveConsent(): void;
  choose(choice: NurseChoice): void;
  setFemaleOnly(femaleOnly: boolean): void;
  /** The question was sent (or turned out to be an emergency): forget it and go to `to`. */
  finish(to: string, state?: unknown): void;
  /** Start over. */
  reset(): void;
}

export const INITIAL_SEND_FLOW: SendFlowState = {
  prepared: null,
  consented: false,
  choice: FIRST_AVAILABLE,
  femaleOnly: false,
  finished: null,
};

export const SendFlowContext = createContext<SendFlowContextValue | null>(null);

/** Identifies a chat thread, so a draft made before she said more is never sent. */
export function threadKeyOf(turns: readonly ChatTurn[]): string {
  return JSON.stringify(turns);
}

/** The draft for this exact thread, if one was prepared and has not expired. */
export function draftFor(
  state: SendFlowState,
  turns: readonly ChatTurn[],
  now = Date.now(),
): PreparedDraft | null {
  const prepared = state.prepared;
  if (!prepared || prepared.threadKey !== threadKeyOf(turns)) return null;
  if (Date.parse(prepared.draft.draftExpiresAt) <= now) return null;
  return prepared.draft;
}

/**
 * What she agrees to share on W07: exactly what the screen shows her, and
 * nothing else. The question (spelling fixed) and its topic are always shared
 * (REQUIRED_SHARED_FIELDS); notes, age range and weeks only when the draft has
 * them. Her original wording is not shown on W07, so it is not shared.
 * Never her name, email, phone or location: those are not fields at all.
 */
export function sharedFieldsFor(draft: QuestionDraft): SharedField[] {
  const fields = new Set<SharedField>(REQUIRED_SHARED_FIELDS);
  if (draft.assistantNotes) fields.add('assistant_notes');
  if (draft.ageRange) fields.add('age_range');
  if (draft.pregnancyWeeks !== null) fields.add('pregnancy_weeks');
  return [...fields];
}
