# @carelayer/tokens

Design tokens for CareLayer as CSS custom properties. **Owned by Hikmah.**

Both frontends import it once at their entry point:

```ts
// apps/web/src/main.tsx and apps/workers/src/main.tsx
import '@carelayer/tokens/tokens.css';
```

There is no build step. Edit `tokens.css` and Vite hot-reloads both apps.
Theme switching (System / Light / Dark) is up to Hikmah. A common approach: a
`data-theme` attribute on `<html>` plus `prefers-color-scheme`, with token values
defined here for each.
