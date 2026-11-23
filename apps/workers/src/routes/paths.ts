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
  today: '/today', // N05 Today: the rest of H9
} as const;
