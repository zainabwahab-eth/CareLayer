import { beforeEach, describe, expect, it } from 'vitest';
import {
  INSTALL_DISMISSED_KEY,
  INSTALL_SNOOZE_MS,
  getInstallMode,
  isInstallSnoozed,
  isIosDevice,
  listenForInstallPrompt,
  promptInstall,
  resetInstallPromptForTests,
  snoozeInstall,
} from './install-prompt';
import {
  ANDROID_UA,
  IPAD_UA,
  IPHONE_UA,
  fakeInstallEvent,
  setStandalone,
  setUserAgent,
} from './test-helpers';

beforeEach(() => {
  resetInstallPromptForTests();
  setStandalone(false);
  setUserAgent(ANDROID_UA);
  listenForInstallPrompt();
});

describe('install prompt', () => {
  it('offers nothing until Chrome says the app can be installed', () => {
    expect(getInstallMode()).toBe('none');
  });

  it('catches Chrome’s install event and holds back its mini-infobar', async () => {
    const event = fakeInstallEvent('accepted');
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(getInstallMode()).toBe('prompt');

    await expect(promptInstall()).resolves.toBe('accepted');
    // Chrome allows one prompt per event.
    expect(getInstallMode()).toBe('none');
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  it('shows iPhone steps on iPhone and iPad', () => {
    setUserAgent(IPHONE_UA, 'iPhone', 5);
    expect(getInstallMode()).toBe('ios');
    setUserAgent(IPAD_UA, 'MacIntel', 5);
    expect(isIosDevice()).toBe(true);
    setUserAgent(IPAD_UA, 'MacIntel', 0); // a real Mac
    expect(isIosDevice()).toBe(false);
  });

  it('offers nothing inside the installed app or once installed', () => {
    setStandalone(true);
    window.dispatchEvent(fakeInstallEvent());
    expect(getInstallMode()).toBe('installed');

    setStandalone(false);
    window.dispatchEvent(new Event('appinstalled'));
    expect(getInstallMode()).toBe('installed');
  });

  it('remembers Not now for 30 days', () => {
    const now = 1_700_000_000_000;
    expect(isInstallSnoozed(now)).toBe(false);
    snoozeInstall(now);
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe(String(now));
    expect(isInstallSnoozed(now + INSTALL_SNOOZE_MS - 1)).toBe(true);
    expect(isInstallSnoozed(now + INSTALL_SNOOZE_MS)).toBe(false);
  });
});
