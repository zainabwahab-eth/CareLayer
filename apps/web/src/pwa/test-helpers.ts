import type { BeforeInstallPromptEvent } from './install-prompt';

/** A Chrome-style install event whose dialog answers `outcome`. */
export function fakeInstallEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
  const prompt = async () => {};
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  return event;
}

export function setUserAgent(userAgent: string, platform = 'Linux x86_64', maxTouchPoints = 0) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  });
}

export const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
export const IPAD_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';

export function setStandalone(standalone: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: standalone && query.includes('standalone'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}
