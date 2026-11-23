# @carelayer/web

Landing page + women's app. React + Vite + TypeScript + React Router, PWA-ready (vite-plugin-pwa). Owned by Hikmah.

## Run

```bash
cp apps/web/.env.example apps/web/.env.local   # from the repo root
npm run dev:web                                  # http://localhost:5173
```

Other scripts: `npm run build:web`, `npm run lint:web`, `npm run typecheck:web`, `npm run preview -w @carelayer/web`.

## Notes

- Design tokens come from `@carelayer/tokens/tokens.css`, imported in `src/main.tsx`.
- API types come from `@carelayer/shared`. Do not redefine contract types locally.
- Only `VITE_*` env vars reach the browser. Never put secrets in them.
- The service worker is disabled in dev. Test install / offline with `build` then `preview`.
- Placeholder icons in `public/icons` come from `node scripts/generate-placeholder-icons.mjs`. Replace with real artwork.

## API layer and mock API

- UI code talks to the API only through `useApi()` (or `useApiQuery()`), typed by the `CareLayerApi` interface in `src/api/types.ts`. All request and response types come from `@carelayer/shared`.
- `VITE_USE_MOCK_API=true` uses the in-browser mock (`src/api/mock/`). Anything else uses the HTTP client (`src/api/http/`) against `VITE_API_URL`. The choice is made once in `src/api/index.ts`, and the unused client is left out of the bundle.
- Mock sign-in code for any email: `123456`. You start signed in as the demo user "Tolu". Log out to test the signed-out state. State resets on reload.
- New mock questions are claimed by a mock health worker after about 45s and answered after about 2 min.
- Messages containing mock red-flag phrases (e.g. "heavy bleeding", "fainted") return the emergency response. These phrases are placeholders until `apps/api/config/red-flags.json` has real entries.
- All mock records are sample data: ids start with `mock_`, emails use example.com, and Stellar values start with `MOCK`. Emergency numbers are marked `verified: false`.

## Real API (HTTP mode)

Set `VITE_USE_MOCK_API=false` and `VITE_API_URL` to apps/api, then restart Vite (env is read at start). The same applies to `apps/workers`.

- The client calls exactly the routes apps/api serves. They are listed and tested in `src/api/http/http-api.test.ts`. Gaps are tracked in `docs/QUESTIONS.md` Q5.
- **No silent fallback.** A failed request always rejects with `ApiError`, and screens show their error state. Status `0` means CareLayer was not reached (offline, CORS, a wrong URL, or the 60 s timeout). A `200` that is not JSON (usually `VITE_API_URL` pointing at the web server, or a Wi-Fi login page) is also an error.
- **Chat is stateless** (`POST /chat`): the thread lives in memory in `ChatProvider` and is sent with each message (last 40 turns). Nothing is stored on the server or in the browser.
- **Sessions:** the access token stays in memory. The refresh token is the httpOnly `cl_refresh` cookie (`Path=/auth`). On `401 UNAUTHENTICATED` the client refreshes once and retries. Concurrent refreshes share one request.
- apps/api must list the web origin in `CORS_ORIGINS`. For local HTTP, leave `AUTH_COOKIE_SECURE` empty or set it to `false`, with `AUTH_COOKIE_SAMESITE=lax`.

## Testing on phones

Two ways to run it. Neither changes backend code.

**A. Same Wi-Fi, plain HTTP (quick layout and API checks; no install or offline).**

1. Find the computer's LAN IP, e.g. `192.168.1.20`.
2. apps/api `.env`: `CORS_ORIGINS=http://192.168.1.20:5173,http://192.168.1.20:5174`, `AUTH_COOKIE_SECURE=false`. Restart the API.
3. apps/web `.env.local`: `VITE_USE_MOCK_API=false`, `VITE_API_URL=http://192.168.1.20:4000`.
4. `npm run dev -w @carelayer/web -- --host`, then open `http://192.168.1.20:5173` on the phone.

Browsers only run service workers on HTTPS or localhost, so A cannot test "Add to Home Screen", offline or updates.

**B. HTTPS tunnel + same-origin proxy (needed for the PWA, and for iPhone sessions).**

A tunnel puts the app and the API on different sites. The `SameSite=Lax` refresh cookie is then not sent, and iPhone Safari blocks cross-site cookies anyway. The Vite dev and preview servers can proxy `/api` to apps/api so every call is same-origin (`vite.api-proxy.ts`).

1. apps/web `.env.local`: `VITE_USE_MOCK_API=false`, `VITE_API_URL=/api`.
2. Build and serve: `npm run build:web && DEV_ALLOWED_HOSTS=<tunnel host> npm run preview -w @carelayer/web`. `API_PROXY_TARGET` defaults to `http://localhost:4000`.
3. Start a tunnel to port 5173 (e.g. `cloudflared tunnel --url http://localhost:5173`) and open its `https://` URL on the phone.
4. For top-ups, set apps/api `PAYSTACK_CALLBACK_URL=https://<tunnel host>/account/wallet`, or Paystack will return her to localhost.
5. The health workers' app works the same way on port 5174.

**What to check on each phone (Android Chrome, iPhone Safari, and the iPhone home-screen app):**

- Sign up and log in with an email code, including paste into the six boxes, auto-advance, and the resend countdown.
- Reload, then close and reopen the tab: she stays signed in. Log out, and Log out everywhere: a reload afterwards stays signed out.
- iPhone home-screen app: it has its own storage, so it **may need its own login once** (TASKS H10). Check the session then survives closing and reopening it.
- Chat: send, wait for the reply (about 10 s on the real LLM), and check the on-screen keyboard does not cover the composer. Send a red-flag message and check the emergency screen and call button.
- Turn on airplane mode mid-chat: the message fails with "Could not reach CareLayer" and Retry works when the connection is back. Open the app offline: the shell and Quick exit still work.
- Wallet top-up through Paystack test checkout and back.
- Quick exit: the button leaves, and Back does not return (Esc twice is desktop only).
- Install: the Android install prompt and banner, and the iPhone "Share → Add to Home Screen" instructions. The app launches standalone.
- Health workers' app: application steps, document upload from the camera and from files (up to 10 MB), and submit.
