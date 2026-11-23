import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUICK_EXIT_ATTRIBUTE, QUICK_EXIT_FLAG_KEY } from './leave-now';
import { QUICK_EXIT_RETURN_PATH, installQuickExitGuard } from './quick-exit-guard';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const pageShow = (persisted: boolean) => {
  const event = new Event('pageshow') as PageTransitionEvent;
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
};
const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  setVisibility('visible');
});

describe('installQuickExitGuard', () => {
  it('reopens on a blank chat instead of the old screen after a quick exit', () => {
    window.sessionStorage.setItem(QUICK_EXIT_FLAG_KEY, '1');
    window.history.replaceState({ idx: 4 }, '', '/consultations/q1');

    uninstall = installQuickExitGuard({ reload: vi.fn() });

    expect(window.location.pathname).toBe(QUICK_EXIT_RETURN_PATH);
    expect(window.history.state).toBeNull();
    expect(window.sessionStorage.getItem(QUICK_EXIT_FLAG_KEY)).toBeNull();
  });

  it('leaves the URL alone on a normal start', () => {
    window.history.replaceState(null, '', '/history');
    uninstall = installQuickExitGuard({ reload: vi.fn() });
    expect(window.location.pathname).toBe('/history');
  });

  it('reloads fresh when the page comes back from the back/forward cache', () => {
    const reload = vi.fn();
    uninstall = installQuickExitGuard({ reload, standalone: () => false });

    pageShow(false);
    expect(reload).not.toHaveBeenCalled();

    document.documentElement.setAttribute(QUICK_EXIT_ATTRIBUTE, '');
    pageShow(true);
    expect(reload).toHaveBeenCalledWith(QUICK_EXIT_RETURN_PATH);
  });

  it('in a browser tab, never interrupts the trip to the neutral site', async () => {
    const reload = vi.fn();
    let now = 0;
    uninstall = installQuickExitGuard({ reload, now: () => now, standalone: () => false });

    document.documentElement.setAttribute(QUICK_EXIT_ATTRIBUTE, '');
    await flush();
    now = 60_000;
    window.dispatchEvent(new Event('blur'));
    setVisibility('hidden');
    setVisibility('visible');
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pointerdown'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('installed app: reloads as a blank chat when she returns from the neutral site', async () => {
    const reload = vi.fn();
    uninstall = installQuickExitGuard({ reload, standalone: () => true });

    // Not leaving: switching apps does nothing.
    setVisibility('hidden');
    setVisibility('visible');
    expect(reload).not.toHaveBeenCalled();

    document.documentElement.setAttribute(QUICK_EXIT_ATTRIBUTE, '');
    await flush();
    window.dispatchEvent(new Event('focus'));
    expect(reload).not.toHaveBeenCalled(); // has not gone anywhere yet

    setVisibility('hidden');
    setVisibility('visible');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith(QUICK_EXIT_RETURN_PATH);
  });

  it('installed app: a tap on the blank page counts as returning only after a while', async () => {
    const reload = vi.fn();
    let now = 1_000;
    uninstall = installQuickExitGuard({ reload, now: () => now, standalone: () => true });

    document.documentElement.setAttribute(QUICK_EXIT_ATTRIBUTE, '');
    await flush();
    now = 2_000;
    window.dispatchEvent(new Event('pointerdown'));
    expect(reload).not.toHaveBeenCalled();

    now = 7_000;
    window.dispatchEvent(new Event('pointerdown'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
