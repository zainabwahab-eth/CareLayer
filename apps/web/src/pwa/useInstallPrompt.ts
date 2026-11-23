import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  getInstallMode,
  isInstallSnoozed,
  promptInstall,
  snoozeInstall,
  subscribeInstall,
  type InstallOutcome,
} from './install-prompt';

/** Install banner state: what to offer, and whether she has said Not now. */
export function useInstallPrompt() {
  const mode = useSyncExternalStore(subscribeInstall, getInstallMode, () => 'none' as const);
  const [snoozed, setSnoozed] = useState(() => isInstallSnoozed());

  const dismiss = useCallback(() => {
    snoozeInstall();
    setSnoozed(true);
  }, []);

  const install = useCallback(async (): Promise<InstallOutcome> => {
    const outcome = await promptInstall();
    // Declined in the browser's own dialog counts as Not now.
    if (outcome === 'dismissed') dismiss();
    return outcome;
  }, [dismiss]);

  return { mode, snoozed, install, dismiss };
}
