/*
 * Start-up work that must run before anything else reads the URL or misses an
 * event. Imported by main.tsx BEFORE ./App: imports run in order, and
 * routes/router.tsx creates the router (which reads the URL) as soon as it loads.
 */
import { installQuickExitGuard } from './components/QuickExit/quick-exit-guard';
import { listenForInstallPrompt } from './pwa/install-prompt';

// After a quick exit, never reopen on the old screen.
installQuickExitGuard();
// Chrome's install offer can arrive before React mounts.
listenForInstallPrompt();
