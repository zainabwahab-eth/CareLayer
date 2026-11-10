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
