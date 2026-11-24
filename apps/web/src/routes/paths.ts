/*
 * Every route in the women's app, in one place.
 * Screen ids (W01-W13) match the Figma frames on "Women - mobile" and
 * "Women - Desktop" (D-W01-D-W13).
 */
export const paths = {
  // Public
  welcome: '/', // W01
  beforeYouStart: '/before-you-start', // W02
  signUp: '/sign-up', // W03
  verifyEmail: '/verify-email', // W04
  logIn: '/log-in', // No Figma frame; mirrors W03
  emergency: '/emergency', // W13 - never behind auth

  // Authenticated
  home: '/home', // W05
  ask: '/ask', // W06 Assistant chat
  askConsent: '/ask/consent', // W07
  askChoose: '/ask/choose', // W08 Choose who answers
  askConfirm: '/ask/confirm', // W09 Confirm and pay
  consultation: '/consultations/:consultationId', // W11 Nurse response
  consultationWaiting: '/consultations/:consultationId/waiting', // W10
  consultations: '/consultations', // W12 Questions sent to nurses (was History)
  history: '/history', // Saved chats with the assistant
  account: '/account', // Account tab (no Figma screen; docs/TASKS.md §3 "Women account")
  wallet: '/account/wallet', // No Figma screen; Paystack returns here (PAYSTACK_CALLBACK_URL)

  // Development only
  components: '/dev/components',
} as const;

export function consultationPath(consultationId: string) {
  return paths.consultation.replace(':consultationId', encodeURIComponent(consultationId));
}

export function consultationWaitingPath(consultationId: string) {
  return paths.consultationWaiting.replace(':consultationId', encodeURIComponent(consultationId));
}

/** Query parameter holding the open saved chat on the Ask screen (/ask?c=…). */
export const CHAT_PARAM = 'c';

/** The Ask screen with a saved chat open (reload and History both use it). */
export function chatPath(conversationId: string) {
  return `${paths.ask}?${CHAT_PARAM}=${encodeURIComponent(conversationId)}`;
}
