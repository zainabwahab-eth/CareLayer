/** True when opened from the home screen (Android, desktop, and iPhone Safari). */
export function isStandaloneDisplay(): boolean {
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    iosStandalone === true ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches)
  );
}
