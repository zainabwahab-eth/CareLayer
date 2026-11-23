import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatus, RESTORED_NOTICE_MS } from './ConnectionStatus';

const setOnline = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionStatus', () => {
  it('shows nothing while online', () => {
    const { container } = render(<ConnectionStatus />);
    expect(container.innerHTML).toBe('');
  });

  it('starts offline when opened without a connection', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    render(<ConnectionStatus />);
    expect(screen.getByRole('status').textContent).toContain('You’re offline');
  });

  it('offline: explains what still works, including emergencies', () => {
    render(<ConnectionStatus />);
    setOnline(false);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('You’re offline');
    expect(notice.textContent).toContain('emergency');
  });

  it('back online: says so, then goes away', () => {
    render(<ConnectionStatus />);
    setOnline(false);
    setOnline(true);
    expect(screen.getByRole('status').textContent).toContain('You’re back online');

    act(() => {
      vi.advanceTimersByTime(RESTORED_NOTICE_MS);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Hide dismisses the offline notice until the connection changes again', () => {
    render(<ConnectionStatus />);
    setOnline(false);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('status')).toBeNull();

    setOnline(true);
    expect(screen.getByRole('status').textContent).toContain('back online');
    setOnline(false);
    expect(screen.getByRole('status').textContent).toContain('offline');
  });
});
