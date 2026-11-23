# @carelayer/workers

Health worker app. React + Vite + TypeScript + React Router, PWA-ready (vite-plugin-pwa). Owned by Hikmah.

## Run

```bash
cp apps/workers/.env.example apps/workers/.env.local   # from the repo root
npm run dev:workers                                  # http://localhost:5174
```

Other scripts: `npm run build:workers`, `npm run lint:workers`, `npm run typecheck:workers`, `npm run preview -w @carelayer/workers`.

## Notes

- Design tokens come from `@carelayer/tokens/tokens.css`, imported in `src/main.tsx`.
- API types come from `@carelayer/shared`. Do not redefine contract types locally.
- Only `VITE_*` env vars reach the browser. Never put secrets in them.
- The service worker is disabled in dev. Test install / offline with `build` then `preview`.
- Placeholder icons in `public/icons` come from `node scripts/generate-placeholder-icons.mjs`. Replace with real artwork.

## Workspace (H11, approved nurses)

Routes: `/today` (N05), `/cases` (N06, `?tab=waiting|active|completed`), `/cases/:id` (details, claim, N07 answer), `/cases/:id/sent` (N08), `/earnings` (N09), `/earnings/withdraw`, `/earnings/withdrawals`, `/updates`, `/profile`, `/settings`. The API calls are in `src/api/types.ts`; the gaps are in `docs/QUESTIONS.md` Q6.

**Mock mode** (`VITE_USE_MOCK_API=true`):

- Log in as `amaka@example.com` (approved, with two weeks of earnings). The code is `123456`, and so is the "confirm it's you" code for withdrawals and the payout wallet.
- There are always a few waiting questions; the first is "Chosen for you".
- After you answer, the mock woman opens it 20 s later, and the ₦400 then shows on Earnings.
- A withdrawal is "Processing" for 15 s, then confirmed. An address ending in `FAIL` fails, so you can see that state.

**On a real phone:** follow apps/web's README, "Testing on phones", using port 5174. Then check:

1. Log in. Today shows your name, availability, today's numbers and waiting questions.
2. Claim a question. The 10-minute countdown runs. The keyboard must not hide "Send answer" or the checklist. Send, and N08 shows.
3. Lock the phone during a claim and come back. The countdown is still right (it is worked out from `claimExpiresAt`). After 10 minutes, "Send" is disabled and your text is kept.
4. Withdraw. The code email arrives, you can paste it into the six boxes, and the result shows (testnet).
5. Profile: edit your bio and languages, and change topics (one must stay on). Settings: change appearance, see your devices, log out of all devices.
6. Rotate the phone and use a large text size: no horizontal scrolling. The tab bar stays above the home indicator.
