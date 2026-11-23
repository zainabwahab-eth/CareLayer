import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NurseApi } from '../../api/types';
import { pdfFile, renderApp, signIn, testApi } from '../../test/render-app';

async function readyToSubmit(api: NurseApi, { documents = 4 } = {}) {
  await signIn(api, 'new@example.com', 'Ngozi Eze');
  await api.nurse.updateProfile({
    role: 'midwife',
    fullNameConfirmed: true,
    licenceNumber: 'RM 4242',
    yearsOfPractice: 6,
  });
  const types = [
    'practising_licence',
    'registration_certificate',
    'government_id',
    'selfie_with_id',
  ] as const;
  for (const t of types.slice(0, documents)) await api.nurse.uploadDocument(t, pdfFile());
}

describe('Step 3: check and send', () => {
  it('summarises the application with links to change each part', async () => {
    const api = testApi();
    await readyToSubmit(api);
    renderApp(api, '/onboarding/submit');
    await screen.findByRole('heading', { name: 'Check and send' });
    const summary = screen.getByLabelText('Your application');
    expect(summary.textContent).toContain('Registered midwife');
    expect(summary.textContent).toContain('RM 4242');
    expect(summary.textContent).toContain('Pregnancy, Periods');
    expect(summary.textContent).toContain('4 of 4 uploaded');
    expect(
      within(summary).getByRole('link', { name: 'Change licence number' }).getAttribute('href'),
    ).toBe('/onboarding/licence');
  });

  it('needs the guidance agreement, then sends and shows N04', async () => {
    const api = testApi();
    await readyToSubmit(api);
    const submit = vi.spyOn(api.nurse, 'submit');
    const { router } = renderApp(api, '/onboarding/submit');
    fireEvent.click(await screen.findByRole('button', { name: 'Send for review' }));
    expect(screen.getByText('Tick this to send your application.')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: /guidance, not diagnoses/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    await screen.findByRole('heading', { name: 'We’re checking your licence' });
    expect(router.state.location.pathname).toBe('/onboarding/review');
    expect((await api.nurse.getProfile()).guidanceNotDiagnosisAccepted).toBe(true);
  });

  it('ONBOARDING_INCOMPLETE lists what is missing, each linking to its step', async () => {
    const api = testApi();
    await readyToSubmit(api, { documents: 3 });
    renderApp(api, '/onboarding/submit');
    fireEvent.click(await screen.findByRole('checkbox', { name: /guidance, not diagnoses/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    const link = await screen.findByRole('link', { name: 'Take a selfie holding your ID' });
    expect(link.getAttribute('href')).toBe('/onboarding/documents');
  });
});

describe('N04 Under review', () => {
  it('pending: the checklist as designed, and the answering preview', async () => {
    const api = testApi();
    await signIn(api, 'funmi@example.com');
    renderApp(api, '/onboarding/review');
    const list = await screen.findByRole('list', { name: 'Review progress' });
    const rows = within(list)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(rows).toEqual([
      'Details and documents receivedDone',
      'Licence checked with the councilIn progress',
      'Identity matched to your selfieWaiting',
      'Ready to answerWaiting',
    ]);
    const preview = screen.getByRole('button', { name: 'Preview how answering works' });
    expect(preview.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(preview);
    expect(screen.getByText(/₦400 in USDC for each answer/)).toBeTruthy();
  });

  it('rejected: the reason and a way back into the steps', async () => {
    const api = testApi();
    await signIn(api, 'hauwa@example.com');
    renderApp(api, '/onboarding/review');
    await screen.findByRole('heading', { name: 'We couldn’t verify your licence yet' });
    expect(screen.getByRole('alert').textContent).toMatch(/too blurry to read/);
    expect(screen.getByRole('link', { name: 'Fix and send again' }).getAttribute('href')).toBe(
      '/onboarding/licence',
    );
  });

  it('notices an approval when she comes back to the tab', async () => {
    const api = testApi();
    await signIn(api, 'funmi@example.com');
    const { router } = renderApp(api, '/onboarding/review');
    await screen.findByRole('heading', { name: 'We’re checking your licence' });
    await api.mockAdmin!.approve();
    document.dispatchEvent(new Event('visibilitychange'));
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening)/ });
    expect(router.state.location.pathname).toBe('/today');
  });

  it('Log out returns to Join', async () => {
    const api = testApi();
    await signIn(api, 'funmi@example.com');
    const { router } = renderApp(api, '/onboarding/review');
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await screen.findByRole('heading', { name: 'Your expertise, on your own time.' });
    expect(router.state.location.pathname).toBe('/');
  });
});
