import type { Route } from './postman-contract';

/*
 * Routes the frontends call that are NOT in the published Postman docs, but that apps/api
 * does serve (each one checked in apps/api/src/modules/<module>/router.ts). They are
 * documentation gaps for Zainab, not frontend bugs: docs/QUESTIONS.md Q7 "Platform API audit".
 * Remove an entry once the route is added to the Postman collection.
 */
export const NOT_DOCUMENTED_BUT_SERVED: ReadonlySet<Route> = new Set<Route>([
  'POST /auth/google', // auth/router.ts: Google sign-in (both apps; hidden until GIS is wired)
  'POST /auth/logout-all', // auth/router.ts (women's Account; nurse Settings)
  'PATCH /me', // users/router.ts: { displayName } (women's Account)
  'DELETE /nurse/documents/:param', // nurses/router.ts (N03 remove a document)
  'POST /auth/step-up', // auth/router.ts: fresh code for withdrawals / payout wallet
  'DELETE /auth/sessions/:param', // auth/router.ts: sign out one device (nurse Settings)
  'GET /nurse/questions/:param', // nurses/router.ts: one case (N07)
]);

/**
 * Documented routes a browser app never calls, on purpose. Anything documented that is
 * neither called nor listed here fails the contract test, so a new endpoint in the docs
 * gets a decision (build it, or say why not).
 */
export const DOCUMENTED_NOT_FOR_BROWSER: ReadonlySet<Route> = new Set<Route>([
  'GET /health', // uptime checks
  'GET /x402-test', // Z2 x402 proof, development only
  'POST /webhooks/paystack', // Paystack -> API, server to server
  'GET /questions/:param/answer', // x402 pay-per-answer for outside agents; the web app collects instead
  'GET /admin/nurses', // admin console (apps/api /admin-console), not a frontend app
  'GET /admin/nurses/:param',
  'POST /admin/nurses/:param/approve',
  'POST /admin/nurses/:param/reject',
]);
