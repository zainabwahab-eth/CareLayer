import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_STEP_TIMEOUT_MS,
  QUICK_EXIT_ATTRIBUTE,
  QUICK_EXIT_FLAG_KEY,
  leaveNow,
} from './leave-now';
import { quickExit } from './quick-exit';

// quickExit() calls window.location.replace, which jsdom cannot perform.
vi.mock('./quick-exit', () => ({ quickExit: vi.fn() }));

describe('leaveNow', () => {
  beforeEach(() => {
    vi.mocked(quickExit).mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides the page, marks the tab and leaves at once from the first entry', () => {
    window.history.replaceState({ idx: 0 }, '', '/ask');
    const go = vi.spyOn(window.history, 'go');

    leaveNow();

    expect(document.documentElement.hasAttribute(QUICK_EXIT_ATTRIBUTE)).toBe(true);
    expect(window.sessionStorage.getItem(QUICK_EXIT_FLAG_KEY)).not.toBeNull();
    expect(go).not.toHaveBeenCalled();
    expect(quickExit).toHaveBeenCalledTimes(1);
  });

  it('steps back to the first CareLayer entry before replacing it, so Back cannot return', () => {
    window.history.replaceState({ idx: 3, key: 'k' }, '', '/consultations/q1');
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});

    leaveNow();

    expect(go).toHaveBeenCalledWith(-3);
    expect(quickExit).not.toHaveBeenCalled();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(quickExit).toHaveBeenCalledTimes(1);

    // The fallback timer must not leave a second time.
    vi.advanceTimersByTime(HISTORY_STEP_TIMEOUT_MS * 2);
    expect(quickExit).toHaveBeenCalledTimes(1);
  });

  it('leaves anyway if the history step never arrives', () => {
    window.history.replaceState({ idx: 2 }, '', '/history');
    vi.spyOn(window.history, 'go').mockImplementation(() => {});

    leaveNow();
    expect(quickExit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HISTORY_STEP_TIMEOUT_MS);
    expect(quickExit).toHaveBeenCalledTimes(1);
  });

  it('a second tap while leaving goes straight to the neutral site', () => {
    window.history.replaceState({ idx: 2 }, '', '/history');
    vi.spyOn(window.history, 'go').mockImplementation(() => {});

    leaveNow();
    leaveNow();
    expect(quickExit).toHaveBeenCalledTimes(1);
  });

  it('still leaves when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    window.history.replaceState(null, '', '/ask');

    leaveNow();
    expect(quickExit).toHaveBeenCalledTimes(1);
  });

  it('does not log out: no API or storage clean-up beyond its own mark', () => {
    window.localStorage.setItem('carelayer.theme', 'dark');
    window.sessionStorage.setItem('carelayer.mockSession', 'abc');
    leaveNow();
    expect(window.localStorage.getItem('carelayer.theme')).toBe('dark');
    expect(window.sessionStorage.getItem('carelayer.mockSession')).toBe('abc');
  });
});
