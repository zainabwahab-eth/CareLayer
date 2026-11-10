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
