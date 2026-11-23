import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp, signIn, testApi } from '../../test/render-app';

/** `name` null: log in as an existing (seeded) nurse instead of signing up. */
async function openLicence(email = 'new@example.com', name: string | null = 'Ngozi Eze') {
  const api = testApi();
  await signIn(api, email, name ?? undefined);
  const utils = renderApp(api, '/onboarding/licence');
  await screen.findByRole('heading', { name: 'Your licence' });
  return { api, ...utils };
}

const group = (name: string) => screen.getByRole('group', { name });
const chip = (groupName: string, label: string) =>
  within(group(groupName)).getByRole('button', { name: label });

function fillValid() {
  fireEvent.click(chip('I am a', 'Registered midwife'));
  fireEvent.click(screen.getByRole('checkbox', { name: /exactly as it appears on my licence/ }));
  fireEvent.change(screen.getByLabelText('Licence number'), { target: { value: 'rm  123456' } });
  fireEvent.change(screen.getByLabelText('Years of practice'), { target: { value: '9' } });
}

describe('N02 Verify licence', () => {
  it('shows Step 1 of 3 and prefills her sign-up name', async () => {
    await openLicence();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Step 1 of 3');
    expect(screen.getByText('Step 1 of 3, about 5 minutes')).toBeTruthy();
    expect((screen.getByLabelText('Full name, as on your licence') as HTMLInputElement).value).toBe(
      'Ngozi Eze',
    );
  });

  it('empty submit: an error on every required field, focus on the first', async () => {
    await openLicence();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(group('I am a').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(chip('I am a', 'Registered nurse'));
    expect(
      screen.getByText('Confirm that this is your name exactly as on your licence.'),
    ).toBeTruthy();
    expect(screen.getByText('Enter your licence number.')).toBeTruthy();
    expect(screen.getByText('Enter your years of practice.')).toBeTruthy();
    expect(screen.getByText('Choose at least one topic you’ll answer.')).toBeTruthy();
  });

  it('choosing a role preselects its default topics (midwife: Pregnancy, Periods)', async () => {
    await openLicence();
    fireEvent.click(chip('I am a', 'Registered midwife'));
    const pressed = within(group('Topics you’ll answer'))
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent);
    expect(pressed).toEqual(['Pregnancy', 'Periods']);

    fireEvent.click(chip('Topics you’ll answer', 'All topics'));
    expect(chip('Topics you’ll answer', 'General').getAttribute('aria-pressed')).toBe('true');
    // Changing the role afterwards keeps her own choice.
    fireEvent.click(chip('I am a', 'Registered nurse'));
    expect(chip('Topics you’ll answer', 'All topics').getAttribute('aria-pressed')).toBe('true');
  });

  it('editing the name asks her to confirm it again', async () => {
    await openLicence();
    const confirm = screen.getByRole('checkbox', {
      name: /exactly as it appears/,
    }) as HTMLInputElement;
    fireEvent.click(confirm);
    expect(confirm.checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Full name, as on your licence'), {
      target: { value: 'Ngozi A. Eze' },
    });
    expect(confirm.checked).toBe(false);
  });

  it('saves only what changed, then topics, and goes to Step 2', async () => {
    const { api, router } = await openLicence();
    const update = vi.spyOn(api.nurse, 'updateProfile');
    const prefs = vi.spyOn(api.nurse, 'updatePreferences');
    fillValid();
    fireEvent.click(chip('Gender (optional)', 'Female'));
    fireEvent.click(chip('Topics you’ll answer', 'Contraception'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('heading', { name: 'Upload your documents' });
    expect(router.state.location.pathname).toBe('/onboarding/documents');
    expect(update).toHaveBeenCalledWith({
      role: 'midwife',
      fullNameConfirmed: true,
      licenceNumber: 'RM 123456',
      yearsOfPractice: 9,
      gender: 'female',
    });
    expect(prefs).toHaveBeenCalledWith({ topics: ['pregnancy', 'periods', 'contraception'] });
    const profile = await api.nurse.getProfile();
    expect(profile).toMatchObject({
      role: 'midwife',
      licenceNumber: 'RM 123456',
      gender: 'female',
    });
  });

  it('a licence number already registered shows on that field', async () => {
    await openLicence();
    fillValid();
    fireEvent.change(screen.getByLabelText('Licence number'), { target: { value: 'RM 000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('This licence number is already registered.');
    expect(screen.getByLabelText('Licence number').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('Licence number'));
  });

  it('no connection: a plain message, and she stays on the step', async () => {
    const { api, router } = await openLicence();
    vi.spyOn(api.nurse, 'updateProfile').mockRejectedValue(
      Object.assign(new Error('x'), { name: 'ApiError', status: 0, code: 'INTERNAL' }),
    );
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(router.state.location.pathname).toBe('/onboarding/licence');
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(false);
  });

  it('after a rejection: shows what to fix above the form', async () => {
    await openLicence('hauwa@example.com', null);
    expect(screen.getByRole('status').textContent).toMatch(/What to fix:.*too blurry to read/);
  });
});
