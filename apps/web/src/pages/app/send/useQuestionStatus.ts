import type { Id, QuestionStatusResponse } from '@carelayer/shared';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../../api/useApi';

/** W10 polls the status every 5 s (docs/TASKS.md H6). */
export const STATUS_POLL_MS = 5_000;

export interface QuestionStatusPoll {
  /** Latest status read, or undefined before the first poll. */
  data: QuestionStatusResponse | undefined;
  /** The last poll failed; the last known status is still shown. */
  error: unknown;
  /** Poll now (e.g. "Check now" after a failure). */
  refresh: () => void;
}

/**
 * GET /questions/:id/status every STATUS_POLL_MS while the question is open or
 * claimed. Paused while the page is hidden and checked at once when she comes
 * back. Stops by itself once the status is answered, expired or cancelled.
 */
export function useQuestionStatus(id: Id, enabled: boolean): QuestionStatusPoll {
  const api = useApi();
  const [data, setData] = useState<QuestionStatusResponse | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), STATUS_POLL_MS);
    };

    const tick = async () => {
      if (document.visibilityState === 'hidden') return; // resumed by visibilitychange
      try {
        const status = await api.questions.getStatus(id);
        if (cancelled) return;
        setData(status);
        setError(undefined);
        if (status.status === 'open' || status.status === 'claimed') schedule();
      } catch (pollError) {
        if (cancelled) return;
        setError(pollError);
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        void tick();
      }
    };

    // A manual refresh polls at once; otherwise the screen's first load is fresh enough.
    if (version > 0) void tick();
    else schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [api, id, enabled, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, refresh };
}
