/*
 * Every route in the health workers' app. Screen ids match the Figma frames on
 * "Nurse -mobile" and "Nurse — Desktop" (docs/TASKS.md §3 screen map).
 */
export const paths = {
  // Public
  join: '/', // N01 Join
  signUp: '/sign-up', // N01 form side (desktop shows it next to the panel)
  logIn: '/log-in', // No frame: N01's form, "Welcome back" (docs/TASKS.md §3)
  verifyEmail: '/verify-email', // No frame: reuses W04's layout (docs/TASKS.md §3)
  // Signed in
  start: '/start', // Sends her to the right screen for her verification status
  licence: '/onboarding/licence', // N02 Verify licence (Step 1 of 3)
  documents: '/onboarding/documents', // N03 Documents (Step 2 of 3)
  submit: '/onboarding/submit', // Step 3 of 3: no frame (docs/QUESTIONS.md)
  review: '/onboarding/review', // N04 Under review (and rejected)
  // Approved: the workspace (H11)
  today: '/today', // N05 Today
  cases: '/cases', // N06 Cases (?tab=waiting|active|completed)
  case: '/cases/:id', // N07 Respond (also the question's details before claiming)
  caseSent: '/cases/:id/sent', // N08 Answer sent
  earnings: '/earnings', // N09 Earnings
  withdraw: '/earnings/withdraw', // No frame: withdraw to a Stellar wallet (code first)
  withdrawals: '/earnings/withdrawals', // No frame: withdrawal history
  updates: '/updates', // No frame: notification centre (derived; docs/QUESTIONS.md Q6)
  profile: '/profile', // No frame: profile (docs/TASKS.md §3 "Nurse profile")
  settings: '/settings', // No frame: appearance, payout wallet, sessions, log out
} as const;

export const casePath = (id: string) => `/cases/${encodeURIComponent(id)}`;
export const caseSentPath = (id: string) => `${casePath(id)}/sent`;
export type CasesTab = 'waiting' | 'active' | 'completed';
export const casesPath = (tab: CasesTab = 'waiting') =>
  tab === 'waiting' ? paths.cases : `${paths.cases}?tab=${tab}`;
