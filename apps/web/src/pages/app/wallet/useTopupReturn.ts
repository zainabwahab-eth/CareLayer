import type { Topup } from '@carelayer/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApi } from '../../../api/useApi';

/*
 * After paying, Paystack sends her back to the wallet with
 * `?topupId=...&reference=...` (contract §5). Poll GET /topups/:id every 2.5 s
 * until it is credited or failed, then tidy the URL so a reload or Back does
 * not start checking again.
 */
const POLL_MS = 2_500;
/** Stop polling after this; she can check again by hand. */
const GIVE_UP_MS = 120_000;

export type TopupReturnState =
  | { phase: 'none' }
  | { phase: 'checking' }
  | { phase: 'pending' | 'paid'; topup: Topup }
  | { phase: 'credited' | 'failed'; topup: Topup }
  | { phase: 'slow'; topup: Topup | null }
  | { phase: 'error'; error: unknown };

export function useTopupReturn(onCredited: () => void) {
  const api = useApi();
  const [searchParams, setSearchParams] = useSearchParams();
  // Captured once: the URL is tidied later, but she keeps seeing the result.
  const [topupId] = useState(() => searchParams.get('topupId'));
  const [state, setState] = useState<TopupReturnState>(
    topupId ? { phase: 'checking' } : { phase: 'none' },
  );
  const [attempt, setAttempt] = useState(0);
  // Refs: setSearchParams changes identity whenever the URL changes (including
  // when we tidy it), which must not restart polling.
  const onCreditedRef = useRef(onCredited);
  const setSearchParamsRef = useRef(setSearchParams);
  useEffect(() => {
    onCreditedRef.current = onCredited;
    setSearchParamsRef.current = setSearchParams;
  });

  useEffect(() => {
    if (!topupId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let last: Topup | null = null;

    const settle = () =>
      setSearchParamsRef.current(
        (params) => {
          params.delete('topupId');
          params.delete('reference');
          return params;
        },
        { replace: true },
      );

    const poll = async () => {
      try {
        const topup = await api.topups.get(topupId);
        if (cancelled) return;
        last = topup;
        if (topup.status === 'credited' || topup.status === 'failed') {
          setState({ phase: topup.status, topup });
          if (topup.status === 'credited') onCreditedRef.current();
          settle();
          return;
        }
        setState({ phase: topup.status, topup });
      } catch (error) {
        if (cancelled) return;
        setState({ phase: 'error', error });
        return;
      }
      if (Date.now() - startedAt >= GIVE_UP_MS) {
        setState({ phase: 'slow', topup: last });
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `attempt` restarts polling after "Check again".
  }, [api, topupId, attempt]);

  const checkAgain = useCallback(() => {
    setState({ phase: 'checking' });
    setAttempt((n) => n + 1);
  }, []);

  const dismiss = useCallback(() => setState({ phase: 'none' }), []);

  return { state, checkAgain, dismiss };
}
