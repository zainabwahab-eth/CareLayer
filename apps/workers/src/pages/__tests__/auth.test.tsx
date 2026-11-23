import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, testApi } from '../../test/render-app';

describe('N01 Join and sign up', () => {
  it('phone: the teal welcome with Sign up with email and Log in', async () => {
    renderApp(testApi(), '/');
    await screen.findByRole('heading', { name: 'Your expertise, on your own time.' });
    expect(screen.getByRole('link', { name: 'Sign up with email' }).getAttribute('href')).toBe(
      '/sign-up',
    );
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/log-in');
  });

  it('desktop: the panel with the sign-up form beside it', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query.includes('60rem'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    renderApp(testApi(), '/');
    await screen.findByRole('heading', { name: 'Join CareLayer' });
    expect(screen.getByLabelText('Full name, as on your licence')).toBeTruthy();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('validates, then signs up through the code screen to Step 1', async () => {
    const { router } = renderApp(testApi(), '/sign-up');
    const submit = await screen.findByRole('button', { name: 'Create account' });
    fireEvent.click(submit);
    expect(
      screen.getByLabelText('Full name, as on your licence').getAttribute('aria-invalid'),
    ).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('Full name, as on your licence'));

    fireEvent.change(screen.getByLabelText('Full name, as on your licence'), {
      target: { value: 'Ngozi Eze' },
    });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'NGOZI@example.com ' },
    });
    fireEvent.click(submit);

    await screen.findByRole('heading', { name: 'Check your email' });
    expect(screen.getByText('ngozi@example.com')).toBeTruthy();
    const boxes = screen.getAllByRole('textbox');
    fireEvent.paste(boxes[0]!, { clipboardData: { getData: () => '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));

    await screen.findByRole('heading', { name: 'Your licence' });
    expect(router.state.location.pathname).toBe('/onboarding/licence');
    expect((screen.getByLabelText('Full name, as on your licence') as HTMLInputElement).value).toBe(
      'Ngozi Eze',
    );
  });

  it('an existing email offers Log in instead', async () => {
    renderApp(testApi(), '/sign-up');
    fireEvent.change(await screen.findByLabelText('Full name, as on your licence'), {
      target: { value: 'Amaka Okafor' },
    });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'amaka@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/already have an account/);
    expect(screen.getByRole('link', { name: 'Log in instead' })).toBeTruthy();
  });

  it('log in with an unknown email offers Join instead', async () => {
    renderApp(testApi(), '/log-in');
    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: 'nobody@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Join instead' })).toBeTruthy());
  });
});
