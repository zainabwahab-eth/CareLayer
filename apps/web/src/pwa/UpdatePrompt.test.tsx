import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatePrompt } from './UpdatePrompt';

const updateServiceWorker = vi.fn(async (_reload?: boolean) => {});
let startWithUpdate = false;

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: useState(startWithUpdate),
    offlineReady: useState(false),
    updateServiceWorker,
  }),
}));

const setControlled = (controlled: boolean) =>
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: controlled ? {} : null },
  });

beforeEach(() => {
  updateServiceWorker.mockClear();
  startWithUpdate = false;
  setControlled(true);
});

describe('UpdatePrompt', () => {
  it('shows nothing when there is no new version', () => {
    const { container } = render(<UpdatePrompt />);
    expect(container.innerHTML).toBe('');
  });

  it('never reloads by itself: waits for Update now', () => {
    startWithUpdate = true;
    render(<UpdatePrompt />);
    expect(screen.getByRole('status').textContent).toContain('A new version of CareLayer');
    expect(updateServiceWorker).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('first visit (no running version yet): nothing to ask', () => {
    startWithUpdate = true;
    setControlled(false);
    const { container } = render(<UpdatePrompt />);
    expect(container.innerHTML).toBe('');
  });

  it('Later hides it without updating', () => {
    startWithUpdate = true;
    render(<UpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });
});
