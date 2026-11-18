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
