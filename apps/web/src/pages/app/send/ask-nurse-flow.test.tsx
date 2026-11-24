import type {
  AnswerResponse,
  EmergencyResponse,
  MyQuestion,
  QuestionStatusResponse,
} from '@carelayer/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../api/ApiProvider';
import { ApiError } from '../../../api/errors';
import { createMockApi } from '../../../api/mock/mock-api';
import { mockMoney } from '../../../api/mock/mock-rules';
import type { CareLayerApi } from '../../../api/types';
import { SendFlowProvider } from '../../../ask-nurse/SendFlowProvider';
import { CONSENT_VERSION } from '../../../ask-nurse/send-flow';
import { AuthProvider } from '../../../auth/AuthProvider';
import { ChatProvider } from '../../../chat/ChatProvider';
import { routes } from '../../../routes/router';

/*
 * W07-W11 against the mock API (VITE_USE_MOCK_API), with single methods
 * replaced to force the states that are hard to reach by timing alone.
 */

beforeEach(() => {
  // jsdom has no layout: the chat scrolls the newest message into view.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('scrollTo', vi.fn());
  // jsdom has no matchMedia: render the mobile layouts.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderApp(api: CareLayerApi, path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ApiProvider api={api}>
      <AuthProvider>
        <ChatProvider>
          <SendFlowProvider>
            <RouterProvider router={router} />
          </SendFlowProvider>
        </ChatProvider>
      </AuthProvider>
    </ApiProvider>,
  );
  return router;
}

/** Chat with the assistant, then "Ask a nurse directly" (opens W07). */
async function askAQuestion(text = 'My period is two weeks late, should I worry?') {
  const field = await screen.findByRole('textbox');
  fireEvent.change(field, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  // The assistant replied: the button is enabled once she has an answered question.
  const askNurse = await screen.findByRole('button', { name: /Ask a nurse directly/ });
  await waitFor(() => expect((askNurse as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(askNurse);
}

/** Each step's own heading: the router keeps the previous screen until the next one has loaded. */
const W07_HEADING = 'Here’s exactly what the nurse or midwife will see';
const onScreen = (name: string) => screen.findByRole('heading', { name });

/** W07 -> W09: agree, keep "First available", reach Confirm and send. */
async function consentAndChoose() {
  await onScreen(W07_HEADING);
  fireEvent.click(await screen.findByRole('checkbox', { name: /I agree to share this/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await onScreen('Who should answer?');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await onScreen('Confirm and send');
}

const question = (overrides: Partial<MyQuestion> = {}): MyQuestion => ({
  id: 'q1',
  status: 'answered',
  category: 'periods',
  originalText: 'my period is late',
  cleanedText: 'My period is late.',
  price: mockMoney(50_000),
  isFree: false,
  nurseSelection: 'first_available',
  chosenNurse: null,
  femaleOnly: false,
  claimsCloseAt: '2026-11-24T10:30:00Z',
  answer: null,
  feedback: null,
  createdAt: '2026-11-24T10:00:00Z',
  ...overrides,
});

const nurse = { id: 'n1', displayName: 'Amaka Okafor', role: 'midwife', verified: true } as const;

const answered: AnswerResponse = {
  answer: {
    questionId: 'q1',
    text: 'A late period is common. Take a pregnancy test if there is any chance.',
    nurse,
    recommendSeeSomeoneToday: true,
    answeredAt: '2026-11-24T10:06:00Z',
  },
  payment: { amount: mockMoney(50_000), stellarTxHash: 'abc123', paidFromTreasury: false },
};

const emergency: EmergencyResponse = {
  kind: 'emergency',
  message: 'This could be serious. Get help now.',
  triggeredBy: ['mock_heavy_bleeding'],
  contacts: [{ label: 'Emergency', number: '112', verified: false }],
  findHospitalUrl: 'https://maps.example/hospital',
};

describe('W07-W09 send to a nurse', () => {
  it('needs her consent, then sends exactly the reviewed draft and opens W10', async () => {
    const api = createMockApi({ latencyMs: 0 });
    const create = vi.spyOn(api.questions, 'create');
    const router = renderApp(api, '/ask');

    await askAQuestion();

    // W07: exactly what the nurse will see.
    await onScreen(W07_HEADING);
    // Shown once POST /chat/draft returns (the chat screen is gone by now).
    expect(await screen.findByText('My period is two weeks late, should I worry?')).toBeTruthy();
    expect(screen.getByText('Topic: Periods')).toBeTruthy();
    expect(
      screen.getByText(/Never shared: your name, email, phone number or location/),
    ).toBeTruthy();

    // Nothing moves on without her tick.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/Tick the box to agree/)).toBeTruthy();
    expect(router.state.location.pathname).toBe('/ask/consent');

    fireEvent.click(screen.getByRole('checkbox', { name: /I agree to share this/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // W08: first available is the default; nurses come from GET /nurses.
    expect(await screen.findByRole('heading', { name: 'Who should answer?' })).toBeTruthy();
    expect(
      (screen.getByRole('radio', { name: /First available/ }) as HTMLInputElement).checked,
    ).toBe(true);
    await screen.findByText(/available for periods questions right now/);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // W09: price, nothing charged now, explicit confirmation.
    expect(await screen.findByRole('heading', { name: 'Confirm and send' })).toBeTruthy();
    expect(screen.getByText('Nothing is charged now')).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));

    // W10.
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/waiting$/));
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0]![0];
    expect(body).toMatchObject({
      originalText: 'My period is two weeks late, should I worry?',
      source: 'web',
      nurseSelection: 'first_available',
      femaleOnly: false,
      consent: { consentVersion: CONSENT_VERSION },
    });
    expect(body.draftToken).toEqual(expect.any(String));
    expect(body.consent.sharedFields).toEqual(expect.arrayContaining(['cleaned_text', 'category']));
    expect(body.consent.sharedFields).not.toContain('original_text');

    // Back from W10 can never reach a screen that would send it again: W08 sends her on to W10.
    const waitingPath = router.state.location.pathname;
    await act(() => router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).toBe(waitingPath));
    expect(create).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Your question')).toBeTruthy();
  });

  it('W08: picks a nurse, and "Only female health workers" asks GET /nurses for female nurses', async () => {
    const api = createMockApi({ latencyMs: 0 });
    const list = vi.spyOn(api.nurses, 'list');
    const create = vi.spyOn(api.questions, 'create');
    renderApp(api, '/ask');

    await askAQuestion();
    await onScreen(W07_HEADING);
    fireEvent.click(await screen.findByRole('checkbox', { name: /I agree to share this/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await onScreen('Who should answer?');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ topic: 'periods' }));

    fireEvent.click(screen.getByRole('switch', { name: 'Only female health workers' }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ topic: 'periods', femaleOnly: true }),
    );

    const nurseRadios = await screen.findAllByRole('radio');
    fireEvent.click(nurseRadios[1]!);
    expect(await screen.findByText(/has 10 minutes to pick it up/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await onScreen('Confirm and send');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({
      nurseSelection: 'chosen_nurse',
      chosenNurseId: expect.any(String),
      femaleOnly: true,
    });
  });

  it('sends a red flag found by the draft straight to W13, never to the nurse queue', async () => {
    const api = createMockApi({ latencyMs: 0 });
    vi.spyOn(api.chat, 'draft').mockResolvedValue(emergency);
    const create = vi.spyOn(api.questions, 'create');
    const router = renderApp(api, '/ask');

    await askAQuestion();

    await waitFor(() => expect(router.state.location.pathname).toBe('/emergency'));
    expect(create).not.toHaveBeenCalled();
  });

  it('opened without a question, W07 goes back to the chat and W08/W09 back to W07', async () => {
    const api = createMockApi({ latencyMs: 0 });
    const draft = vi.spyOn(api.chat, 'draft');
    const router = renderApp(api, '/ask/confirm');

    await waitFor(() => expect(router.state.location.pathname).toBe('/ask'));
    expect(draft).not.toHaveBeenCalled();
  });

  it('shows a retry when the draft fails', async () => {
    const api = createMockApi({ latencyMs: 0 });
    const draft = vi
      .spyOn(api.chat, 'draft')
      .mockRejectedValueOnce(
        new ApiError(503, 'SERVICE_UNAVAILABLE', 'The assistant is busy. Try again.'),
      );
    renderApp(api, '/ask');

    await askAQuestion();

    expect(await screen.findByText('The assistant is busy. Try again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Spelling tidied. Nothing removed or shortened.')).toBeTruthy();
    expect(draft).toHaveBeenCalledTimes(2);
  });

  it('when sending may have gone through, sends her to History instead of resending', async () => {
    const api = createMockApi({ latencyMs: 0 });
    const create = vi
      .spyOn(api.questions, 'create')
      .mockRejectedValue(new ApiError(0, 'INTERNAL', 'The request took too long.'));
    renderApp(api, '/ask');

    await askAQuestion();
    await consentAndChoose();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));

    expect(
      await screen.findByText(/could not confirm whether your question was sent/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Check History' }).getAttribute('href')).toEqual(
      '/history',
    );
    expect(screen.queryByRole('button', { name: 'Confirm and send' })).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('asks her to approve a price above her limit before sending', async () => {
    const api = createMockApi({ latencyMs: 0 });
    vi.spyOn(api.me, 'getSettings').mockResolvedValue({
      ...(await api.me.getSettings()),
      spendingLimitPerAnswerKobo: 20_000,
    });
    // Paid quote: her free answers are used up.
    const realDraft = api.chat.draft.bind(api.chat);
    vi.spyOn(api.chat, 'draft').mockImplementation(async (body) => {
      const result = await realDraft(body);
      return result.kind === 'draft'
        ? { ...result, offer: { ...result.offer, isFree: false, exceedsSpendingLimit: true } }
        : result;
    });
    const create = vi.spyOn(api.questions, 'create').mockRejectedValue(new Error('stop'));
    renderApp(api, '/ask');

    await askAQuestion();
    await consentAndChoose();

    const approve = await screen.findByRole('checkbox', { name: /I approve paying ₦500/ });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));
    expect(await screen.findByText(/Approve the price to send/)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(approve);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].approvedAboveLimit).toBe(true);
  });
});

describe('W10 Waiting', () => {
  const statusOf = (status: QuestionStatusResponse['status']): QuestionStatusResponse => ({
    id: 'q1',
    status,
    category: 'periods',
    claimsCloseAt: '2026-11-24T10:30:00Z',
    answeredAt: null,
    expiredAt: null,
  });

  it('shows an open question, then moves to W11 once the status says answered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = createMockApi({ latencyMs: 0 });
    // Open on W10; answered by the time W11 loads it.
    vi.spyOn(api.questions, 'getMine')
      .mockResolvedValueOnce(question({ status: 'open' }))
      .mockResolvedValue(question());
    const getStatus = vi
      .spyOn(api.questions, 'getStatus')
      .mockResolvedValue({ ...statusOf('answered'), answeredAt: '2026-11-24T10:06:00Z' });
    const router = renderApp(api, '/consultations/q1/waiting');

    expect(
      await screen.findByRole('heading', { name: 'Waiting for a nurse or midwife' }),
    ).toBeTruthy();
    expect(screen.getByText('Nothing charged yet. ₦500 on delivery.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Feeling worse while you wait/ }).getAttribute('href'),
    ).toEqual('/emergency');

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    await waitFor(() => expect(router.state.location.pathname).toBe('/consultations/q1'));
    expect(getStatus).toHaveBeenCalled();
  });

  it('says an expired question was not charged', async () => {
    const api = createMockApi({ latencyMs: 0 });
    vi.spyOn(api.questions, 'getMine').mockResolvedValue(question({ status: 'expired' }));
    renderApp(api, '/consultations/q1/waiting');

    expect(
      await screen.findByRole('heading', { name: 'No nurse or midwife was free in time' }),
    ).toBeTruthy();
    expect(screen.getByText(/You were not charged/)).toBeTruthy();
  });

  it('shows not found for a question that is not hers', async () => {
    const api = createMockApi({ latencyMs: 0 });
    vi.spyOn(api.questions, 'getMine').mockRejectedValue(
      new ApiError(404, 'NOT_FOUND', 'We could not find that question.'),
    );
    renderApp(api, '/consultations/nope/waiting');

    expect(
      await screen.findByRole('heading', { name: 'We couldn’t find this question' }),
    ).toBeTruthy();
  });
});

describe('W11 Nurse response', () => {
  it('opens a paid answer only on her tap, then shows the answer and the Stellar receipt', async () => {
    const api = createMockApi({ latencyMs: 0 });
    vi.spyOn(api.questions, 'getMine').mockResolvedValue(question());
    const collect = vi.spyOn(api.questions, 'collectAnswer').mockResolvedValue(answered);
    renderApp(api, '/consultations/q1');

    const pay = await screen.findByRole('button', { name: 'Pay ₦500 and open' });
    expect(collect).not.toHaveBeenCalled();
    fireEvent.click(pay);

    expect(await screen.findByText(/A late period is common/)).toBeTruthy();
    expect(collect).toHaveBeenCalledWith('q1', undefined);
    expect(screen.getByText('Amaka Okafor')).toBeTruthy();
    expect(screen.getByText('Answered in 6 min')).toBeTruthy();
    expect(screen.getByText('Your nurse recommends you see someone today')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /View receipt on Stellar/ }).getAttribute('href'),
    ).toEqual(expect.stringContaining('abc123'));
    // The top bar's Back and the footer button both go to History.
    for (const link of screen.getAllByRole('link', { name: 'Back to history' })) {
      expect(link.getAttribute('href')).toEqual('/history');
    }
  });

  it('asks for approval when the price is above her limit, then sends approvedAboveLimit', async () => {
    const api = createMockApi({ latencyMs: 0 });
    vi.spyOn(api.questions, 'getMine').mockResolvedValue(question());
    const collect = vi
      .spyOn(api.questions, 'collectAnswer')
      .mockRejectedValueOnce(
        new ApiError(409, 'SPENDING_LIMIT_EXCEEDED', 'Above your limit.', {
          priceKobo: 50_000,
          spendingLimitKobo: 20_000,
        }),
      )
      .mockResolvedValueOnce(answered);
    renderApp(api, '/consultations/q1');

    fireEvent.click(await screen.findByRole('button', { name: 'Pay ₦500 and open' }));
    const approveButton = await screen.findByRole('button', { name: 'Approve and open my answer' });
    expect((approveButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /above my limit of ₦200/ }));
    fireEvent.click(approveButton);

    expect(await screen.findByText(/A late period is common/)).toBeTruthy();
    expect(collect).toHaveBeenLastCalledWith('q1', { approvedAboveLimit: true });
  });

  it('offers a top-up when her balance is too low, and shows no answer', async () => {
    const api = createMockApi({ latencyMs: 0 });
    vi.spyOn(api.questions, 'getMine').mockResolvedValue(question());
    vi.spyOn(api.questions, 'collectAnswer').mockRejectedValue(
      new ApiError(409, 'INSUFFICIENT_BALANCE', 'Not enough.', {
        price: mockMoney(50_000),
        balance: mockMoney(10_000),
      }),
    );
    renderApp(api, '/consultations/q1');

    fireEvent.click(await screen.findByRole('button', { name: 'Pay ₦500 and open' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/your balance is ₦100/)).toBeTruthy();
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Top up' }).getAttribute('href'),
    ).toEqual('/account/wallet');
    expect(screen.queryByText(/A late period is common/)).toBeNull();
  });

  it('shows an answer she already opened with its receipt, without asking to pay', async () => {
    const api = createMockApi({ latencyMs: 0 });
    vi.spyOn(api.questions, 'getMine').mockResolvedValue(question({ answer: answered.answer }));
    const collect = vi.spyOn(api.questions, 'collectAnswer').mockResolvedValue(answered);
    renderApp(api, '/consultations/q1');

    expect(await screen.findByText(/A late period is common/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pay ₦500/ })).toBeNull();
    expect(await screen.findByRole('link', { name: /View receipt on Stellar/ })).toBeTruthy();
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it('records helpful feedback', async () => {
    const api = createMockApi({ latencyMs: 0 });
    vi.spyOn(api.questions, 'getMine').mockResolvedValue(question({ answer: answered.answer }));
    vi.spyOn(api.questions, 'collectAnswer').mockResolvedValue(answered);
    const feedback = vi.spyOn(api.questions, 'submitFeedback').mockResolvedValue({
      questionId: 'q1',
      helpful: true,
      updatedAt: '2026-11-24T10:10:00Z',
    });
    renderApp(api, '/consultations/q1');

    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));
    expect(await screen.findByText(/Thank you/)).toBeTruthy();
    expect(feedback).toHaveBeenCalledWith('q1', { helpful: true });
    expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toEqual(
      'true',
    );
  });

  it('sends a question that is not answered yet back to W10', async () => {
    const api = createMockApi({ latencyMs: 0 });
    vi.spyOn(api.questions, 'getMine').mockResolvedValue(question({ status: 'claimed' }));
    const collect = vi.spyOn(api.questions, 'collectAnswer');
    const router = renderApp(api, '/consultations/q1');

    await waitFor(() => expect(router.state.location.pathname).toBe('/consultations/q1/waiting'));
    expect(collect).not.toHaveBeenCalled();
  });
});
