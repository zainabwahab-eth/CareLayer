import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { InstallBanner } from './InstallBanner';
import {
  INSTALL_DISMISSED_KEY,
  listenForInstallPrompt,
  resetInstallPromptForTests,
} from './install-prompt';
import {
  ANDROID_UA,
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

const heading = () => screen.queryByRole('heading', { name: 'Add CareLayer to your home screen' });

describe('InstallBanner', () => {
  it('Android without an install offer: shows the browser-menu steps', () => {
    render(<InstallBanner />);
    expect(heading()).not.toBeNull();
    expect(screen.getByRole('list').textContent).toContain('Add to Home screen');
    expect(screen.queryByRole('button', { name: 'Install CareLayer' })).toBeNull();
  });

  it('a computer browser without an install offer: shows Chrome/Edge and phone steps', () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Win32',
    );
    render(<InstallBanner />);
    expect(screen.getByRole('list').textContent).toContain('Install CareLayer');
  });

  it('Safari on a Mac: shows Add to Dock', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'MacIntel',
    );
    render(<InstallBanner />);
    expect(screen.getByRole('list').textContent).toContain('Add to Dock');
  });

  it('Android: Chrome offers an install, and Install opens the dialog', async () => {
    render(<InstallBanner />);

    act(() => {
      window.dispatchEvent(fakeInstallEvent('accepted'));
    });
    expect(heading()).not.toBeNull();
    expect(screen.queryByRole('list')).toBeNull(); // the Install button replaces the steps

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install CareLayer' }));
    });
    expect(heading()).toBeNull();
  });

  it('Android: declining in the browser dialog counts as Not now', async () => {
    render(<InstallBanner />);
    act(() => {
      window.dispatchEvent(fakeInstallEvent('dismissed'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install CareLayer' }));
    });
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).not.toBeNull();
  });

  it('iPhone: shows the Share > Add to Home Screen steps, with no Install button', () => {
    setUserAgent(IPHONE_UA, 'iPhone', 5);
    render(<InstallBanner />);
    expect(heading()).not.toBeNull();
    const steps = screen.getByRole('list');
    expect(steps.textContent).toContain('Share');
    expect(steps.textContent).toContain('Add to Home Screen');
    expect(screen.queryByRole('button', { name: 'Install CareLayer' })).toBeNull();
  });

  it('Not now hides it and keeps it hidden next time', () => {
    setUserAgent(IPHONE_UA, 'iPhone', 5);
    const { unmount } = render(<InstallBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(heading()).toBeNull();
    unmount();

    render(<InstallBanner />);
    expect(heading()).toBeNull();
  });

  it('never shows inside the installed app', () => {
    setStandalone(true);
    setUserAgent(IPHONE_UA, 'iPhone', 5);
    render(<InstallBanner />);
    expect(heading()).toBeNull();
  });
});
