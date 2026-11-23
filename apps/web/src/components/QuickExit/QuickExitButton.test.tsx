import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickExitButton } from './QuickExitButton';
import { leaveNow } from './leave-now';
import { QUICK_EXIT_SHORTCUT_WINDOW_MS } from './quick-exit';
import { useQuickExitShortcut } from './useQuickExitShortcut';

vi.mock('./leave-now', () => ({ leaveNow: vi.fn() }));

const press = (key: string, timeStamp: number, repeat = false) => {
  const event = new KeyboardEvent('keydown', { key, repeat, bubbles: true });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  act(() => {
    window.dispatchEvent(event);
  });
};

beforeEach(() => vi.mocked(leaveNow).mockClear());

describe('QuickExitButton', () => {
  it('is a named button that leaves on one tap', () => {
    render(<QuickExitButton />);
    const button = screen.getByRole('button', { name: 'Quick exit: leave CareLayer now' });
    fireEvent.click(button);
    expect(leaveNow).toHaveBeenCalledTimes(1);
  });

  it('desktop block shows and announces the Esc Esc shortcut', () => {
    render(<QuickExitButton variant="block" />);
    const button = screen.getByRole('button', { name: /quick exit/i });
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Escape Escape');
    expect(button.textContent).toContain('Esc Esc');
  });
});

describe('useQuickExitShortcut', () => {
  it('Esc twice quickly leaves', () => {
    renderHook(() => useQuickExitShortcut());
    press('Escape', 1_000);
    expect(leaveNow).not.toHaveBeenCalled();
    press('Escape', 1_000 + QUICK_EXIT_SHORTCUT_WINDOW_MS - 1);
    expect(leaveNow).toHaveBeenCalledTimes(1);
  });

  it('ignores a slow second Esc, held-down repeats and other keys', () => {
    renderHook(() => useQuickExitShortcut());
    press('Escape', 1_000);
    press('Escape', 1_000 + QUICK_EXIT_SHORTCUT_WINDOW_MS + 1);
    press('Escape', 1_000 + QUICK_EXIT_SHORTCUT_WINDOW_MS + 50, true);
    press('Enter', 1_000 + QUICK_EXIT_SHORTCUT_WINDOW_MS + 60);
    expect(leaveNow).not.toHaveBeenCalled();
  });
});
