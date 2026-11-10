# @carelayer/shared

Shared TypeScript types and constants for the CareLayer API contract. Mirrors `docs/API_CONTRACT.md` (v0).

- Built to `dist/` with `tsc` (runs automatically on `npm install`; `npm run dev` watches it).
- Import from `@carelayer/shared` in every app. Do not redefine contract types locally.
- Changing a type here is a contract change: update `docs/API_CONTRACT.md` in the same commit and tell the other developer.
