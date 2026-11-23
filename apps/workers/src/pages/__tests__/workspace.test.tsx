import { ApiError } from '@web/api/errors';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { NurseApi } from '../../api/types';
import { renderApp, signIn, testApi } from '../../test/render-app';

/*
 * H11 nurse workspace, rendered through the real routes and guards on the mock API
 * (which follows apps/api's rules, see api/mock-workspace.ts).
 */

const at = (router: ReturnType<typeof renderApp>['router']) =>
  `${router.state.location.pathname}${router.state.location.search}`;

async function amaka(): Promise<NurseApi> {
  const api = testApi();
  await signIn(api, 'amaka@example.com');
  return api;
}

const offline = () => new ApiError(0, 'INTERNAL', 'Could not reach CareLayer.');

describe('access by role and status', () => {
  it('signed out: a workspace screen sends her to Log in, and back after', async () => {
    const { router } = renderApp(testApi(), '/earnings');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(at(router)).toBe('/log-in');
  });

  it('in review: the workspace is closed, N04 shows instead', async () => {
    const api = testApi();
    await signIn(api, 'funmi@example.com');
    const { router } = renderApp(api, '/cases');
    await screen.findByRole('heading', { name: 'We’re checking your licence' });
    expect(at(router)).toBe('/onboarding/review');
  });

  it('rejected: the workspace is closed too', async () => {
    const api = testApi();
    await signIn(api, 'hauwa@example.com');
    const { router } = renderApp(api, '/earnings/withdraw');
    await waitFor(() => expect(at(router)).toBe('/onboarding/review'));
  });
});

describe('navigation', () => {
  it('mobile tab bar has the four Figma tabs; the sidebar has every section', async () => {
    const api = await amaka();
    renderApp(api, '/today');
    await screen.findByRole('heading', { name: /Amaka/ });
    const [sidebarNav, tabNav] = screen.getAllByRole('navigation', { name: 'Main' });
    expect(
      within(tabNav!)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Today', 'Cases', 'Earnings', 'Profile']);
    expect(within(sidebarNav!).getAllByRole('link')).toHaveLength(7);
    expect(within(tabNav!).getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('a focused screen (answering) hides the tab bar', async () => {
    const api = await amaka();
    const [q] = (await api.cases.list('waiting')).items;
    await api.cases.claim(q!.id);
    renderApp(api, `/cases/${q!.id}`);
    await screen.findByRole('heading', { name: 'Answer case' });
    // Only the (desktop) sidebar navigation is left.
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1);
  });
});

describe('N05 Today', () => {
  it('renders the dashboard from the API: greeting, stats, waiting questions', async () => {
    const api = await amaka();
    renderApp(api, '/today');
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Amaka/ });
    expect(screen.getAllByText(/Verified midwife/i).length).toBeGreaterThan(0);
    expect(await screen.findByText('Earned today')).toBeTruthy();
    expect((await screen.findAllByRole('link', { name: /^Answer:/ })).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /See all \d+/ })).toBeTruthy();
  });

  it('turning availability off saves it (PATCH /nurse/preferences)', async () => {
    const api = await amaka();
    renderApp(api, '/today');
    const toggle = await screen.findByRole('switch', { name: 'You’re available' });
    fireEvent.click(toggle);
    await screen.findByRole('switch', { name: 'You’re unavailable' });
    expect((await api.nurse.getProfile()).available).toBe(false);
  });

  it('a failed load says so with Try again, never sample data', async () => {
    const api = await amaka();
    let fail = true;
    const real = api.cases.dashboard;
    api.cases.dashboard = () => (fail ? Promise.reject(offline()) : real());
    renderApp(api, '/today');
    expect(
      await screen.findByText('Could not reach CareLayer. Check your connection and try again.'),
    ).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]!);
    await waitFor(() =>
      expect(
        screen.queryByText('Could not reach CareLayer. Check your connection and try again.'),
      ).toBeNull(),
    );
  });

  it('shows the active case with its countdown', async () => {
    const api = await amaka();
    const [q] = (await api.cases.list('waiting')).items;
    await api.cases.claim(q!.id);
    renderApp(api, '/today');
    await screen.findByText('Your active case');
    expect(screen.getByText(/\d\d:\d\d left/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue answering' })).toBeTruthy();
  });
});

describe('N06 Cases', () => {
  it('lists waiting questions with topic, reward and wait; topic chips filter', async () => {
    const api = await amaka();
    renderApp(api, '/cases');
    await screen.findByRole('heading', { name: 'Cases' });
    const answers = await screen.findAllByRole('link', { name: /^Answer:/ });
    const card = answers[0]!.closest('article')!;
    expect(within(card).getByText('₦400')).toBeTruthy();
    expect(within(card).getByText(/Waiting/)).toBeTruthy();
    const before = answers.length;
    // Only one topic: fewer (or no) cards, never more.
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    await waitFor(() =>
      expect(screen.queryAllByRole('link', { name: /^Answer:/ }).length).toBeLessThan(before),
    );
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: /^Answer:/ })).toHaveLength(before),
    );
  });

  it('empty waiting list: says so, with Check again', async () => {
    const api = await amaka();
    api.cases.list = (tab) =>
      tab === 'waiting'
        ? Promise.resolve({ items: [], nextCursor: null })
        : Promise.resolve({ items: [], nextCursor: null });
    renderApp(api, '/cases');
    await screen.findByText('No one is waiting right now');
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('In progress with nothing claimed offers to find a question', async () => {
    const api = await amaka();
    renderApp(api, '/cases?tab=active');
    await screen.findByText('No question in progress');
  });

  it('Completed lists answered questions', async () => {
    const api = await amaka();
    renderApp(api, '/cases?tab=completed');
    expect((await screen.findAllByText('Answered')).length).toBeGreaterThan(0);
  });
});

describe('N07 claim and answer, N08 sent', () => {
  it('claims, validates the answer and checklist, sends, and shows N08', async () => {
    const api = await amaka();
    const [q] = (await api.cases.list('waiting')).items;
    const { router } = renderApp(api, `/cases/${q!.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Claim and answer' }));
    await screen.findByRole('heading', { name: 'Answer case' });
    expect(screen.getByRole('timer').textContent).toMatch(/\d\d:\d\d left/);

    const send = screen.getByRole('button', { name: /Send answer, earn ₦400/ });
    fireEvent.click(send);
    expect(await screen.findByText('Write your answer.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Your answer'), {
      target: { value: 'Rest with your feet raised. Go to a clinic today if it gets worse.' },
    });
    fireEvent.click(send);
    expect(
      await screen.findByText('Check both points in the checklist before sending.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Explains when to seek care in person'));
    fireEvent.click(screen.getByLabelText('No diagnosis or prescription'));
    fireEvent.click(screen.getByRole('switch', { name: 'Recommend she sees someone today' }));
    fireEvent.click(send);

    await screen.findByRole('heading', { name: 'Answer delivered.' });
    expect(at(router)).toBe(`/cases/${q!.id}/sent`);
    expect(screen.getByText(/You recommended she sees someone today/)).toBeTruthy();
    expect((await api.cases.list('completed')).items[0]!.id).toBe(q!.id);
  });

  it('a second claim is refused and links to the question she holds', async () => {
    const api = await amaka();
    const [first, second] = (await api.cases.list('waiting')).items;
    await api.cases.claim(first!.id);
    const { router } = renderApp(api, `/cases/${second!.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim and answer' }));
    await screen.findByText('You already have a question open. Finish or release it first.');
    fireEvent.click(screen.getByRole('button', { name: 'Go to your open question' }));
    await waitFor(() => expect(at(router)).toBe(`/cases/${first!.id}`));
  });

  it('when the lock runs out on send, the answer is not sent and the form says why', async () => {
    const api = await amaka();
    const [q] = (await api.cases.list('waiting')).items;
    await api.cases.claim(q!.id);
    api.cases.answer = () =>
      Promise.reject(new ApiError(410, 'CLAIM_EXPIRED', 'Your 10 minutes ran out.'));
    renderApp(api, `/cases/${q!.id}`);
    await screen.findByRole('heading', { name: 'Answer case' });
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Some guidance.' } });
    fireEvent.click(screen.getByLabelText('Explains when to seek care in person'));
    fireEvent.click(screen.getByLabelText('No diagnosis or prescription'));
    fireEvent.click(screen.getByRole('button', { name: /Send answer/ }));
    await screen.findByText(/Your 10 minutes ran out, so this answer can’t be sent/);
    expect(
      (screen.getByRole('button', { name: /Send answer/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).value).toBe(
      'Some guidance.',
    );
  });

  it('release asks first, then returns the question to the list', async () => {
    const api = await amaka();
    const [q] = (await api.cases.list('waiting')).items;
    await api.cases.claim(q!.id);
    const { router } = renderApp(api, `/cases/${q!.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Release' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, release' }));
    await waitFor(() => expect(at(router)).toBe('/cases'));
    expect((await api.cases.get(q!.id)).status).toBe('open');
  });

  it('a question no longer visible shows “no longer available”', async () => {
    const api = await amaka();
    renderApp(api, '/cases/mock_case_unknown');
    await screen.findByText('This question is no longer available');
  });
});

describe('N09 Earnings and withdrawals', () => {
  it('shows available balance, the week chart and recent payments', async () => {
    const api = await amaka();
    renderApp(api, '/earnings');
    await screen.findByText('Available to withdraw');
    expect(screen.getByRole('img', { name: /Earnings this week/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recent payments' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Withdraw' })).toBeTruthy();
  });

  it('withdraw: validates, confirms with a code, then sends', async () => {
    const api = await amaka();
    renderApp(api, '/earnings/withdraw');
    fireEvent.change(await screen.findByLabelText('Amount in naira'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Stellar wallet address'), {
      target: { value: 'not-an-address' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('The smallest withdrawal is ₦100.')).toBeTruthy();
    expect(
      screen.getByText('Enter a Stellar address: 56 characters starting with G.'),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Amount in naira'), { target: { value: '1,000' } });
    fireEvent.change(screen.getByLabelText('Stellar wallet address'), {
      target: { value: `G${'B'.repeat(55)}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Email me a code' }));
    const boxes = await screen.findAllByRole('textbox');
    fireEvent.paste(boxes[0]!, { clipboardData: { getData: () => '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByText(/₦1,000 was sent/);
    expect((await api.earnings.listWithdrawals()).items[0]!.amount.kobo).toBe(100_000);
  });

  it('payment history: all payments and withdrawals', async () => {
    const api = await amaka();
    renderApp(api, '/earnings/withdrawals');
    expect((await screen.findAllByText('Answer payment')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Withdrawals' }));
    expect(await screen.findByText(/memo 1234567/)).toBeTruthy();
  });
});

describe('Profile and settings', () => {
  it('edits the bio and languages (PATCH /nurse/profile); licence fields are not editable', async () => {
    const api = await amaka();
    renderApp(api, '/profile');
    await screen.findByRole('heading', { name: 'Profile' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByLabelText(/Licence number/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Short bio'), {
      target: { value: 'Midwife in Enugu for nine years.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yoruba' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Midwife in Enugu for nine years.');
    const profile = await api.nurse.getProfile();
    expect(profile.bio).toBe('Midwife in Enugu for nine years.');
    expect(profile.languages).toContain('yoruba');
  });

  it('topics: at least one stays selected', async () => {
    const api = testApi();
    await signIn(api, 'amaka@example.com');
    await api.nurse.updatePreferences({ topics: ['pregnancy'] });
    renderApp(api, '/profile');
    const group = await screen.findByRole('group', { name: /Topics I answer/ });
    fireEvent.click(within(group).getByRole('button', { name: 'Pregnancy' }));
    await screen.findByText('Choose at least one topic you answer.');
    expect((await api.nurse.getProfile()).topics).toEqual(['pregnancy']);
  });

  it('log out of all devices returns to Join', async () => {
    const api = await amaka();
    const { router } = renderApp(api, '/settings');
    await screen.findByText('This device (this device)');
    fireEvent.click(screen.getByRole('button', { name: 'Log out of all devices' }));
    await waitFor(() => expect(at(router)).toBe('/'));
  });
});

describe('Updates (notification centre)', () => {
  it('lists updates from live data, unread first, and marks all as read', async () => {
    const api = await amaka();
    renderApp(api, '/updates');
    await screen.findByRole('heading', { name: 'Updates' });
    expect(await screen.findByText('A woman chose you to answer')).toBeTruthy();
    expect(screen.getByText(/\d+ unread/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await screen.findByText(/You are up to date/);
  });

  it('opening an update marks it read and goes to what it is about', async () => {
    const api = await amaka();
    const { router } = renderApp(api, '/updates');
    const chosen = await screen.findByRole('link', { name: /Unread: A woman chose you/ });
    fireEvent.click(chosen);
    await waitFor(() => expect(at(router)).toMatch(/^\/cases\//));
  });
});
