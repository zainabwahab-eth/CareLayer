import { isStandaloneDisplay } from './display-mode';

/*
 * Add to Home Screen (docs/PROJECT_BRIEF.md §8): Android install prompt,
 * iPhone step-by-step instructions.
 *
 * Chrome fires `beforeinstallprompt` once, often before React has mounted, so
 * it is caught here at start-up (main.tsx calls listenForInstallPrompt) and
 * kept until she taps Install. iPhone Safari has no prompt: the banner shows
 * the Share > Add to Home Screen steps instead.
 */

/** Chrome's install event (not in the DOM typings). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * prompt    - Android / desktop Chrome or Edge: an Install button opens the browser's dialog
 * ios       - iPhone or iPad, in the browser: show the Share steps
 * installed - already running from the home screen
 * none      - nothing to offer in this browser
 */
export type InstallMode = 'prompt' | 'ios' | 'installed' | 'none';
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function isIosDevice(nav: Navigator = window.navigator): boolean {
  if (/iphone|ipad|ipod/i.test(nav.userAgent)) return true;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
}

function onBeforeInstallPrompt(event: Event) {
  // Keep Chrome's mini-infobar away: she gets our banner, once, and can say Not now.
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  notify();
}

function onInstalled() {
  deferred = null;
  installed = true;
  notify();
}

let listening = false;
/** Call once at start-up, before React renders. Safe to call again. */
export function listenForInstallPrompt() {
  if (listening) return;
  listening = true;
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onInstalled);
}

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallMode(): InstallMode {
  if (installed || isStandaloneDisplay()) return 'installed';
  if (deferred) return 'prompt';
  if (isIosDevice()) return 'ios';
  return 'none';
}

/** Open the browser's install dialog. Chrome allows this once per event. */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

/* "Not now" is remembered on this device for a while, then the banner may return once. */
export const INSTALL_DISMISSED_KEY = 'carelayer.installBanner.dismissedAt';
export const INSTALL_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export function isInstallSnoozed(now = Date.now()): boolean {
  try {
    const at = Number(window.localStorage.getItem(INSTALL_DISMISSED_KEY));
    return Number.isFinite(at) && at > 0 && now - at < INSTALL_SNOOZE_MS;
  } catch {
    return false;
  }
}

export function snoozeInstall(now = Date.now()) {
  try {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(now));
  } catch {
    // Storage blocked: the banner hides for this visit only.
  }
}

/** Tests only: forget the captured event. */
export function resetInstallPromptForTests() {
  deferred = null;
  installed = false;
  notify();
}
