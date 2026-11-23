import type { Page } from '@carelayer/shared';
import { isSessionError } from '@web/auth/auth-flow';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DependencyList,
} from 'react';
import { useNurseApi } from '../api/api-context';
import type { NurseApi } from '../api/types';
import { useAuth } from '../auth/useAuth';

/*
 * Small read hooks for the nurse workspace, the same shape as apps/web's
 * useApiQuery / usePagedQuery but on the nurse API. A failed request is an
 * error state, never sample data. A session that has ended sends her to Log in.
 */

export type QueryState<T> =
  | { status: 'loading'; data: undefined; error: undefined }
  | { status: 'success'; data: T; error: undefined }
  | { status: 'error'; data: undefined; error: Error };

export type QueryResult<T> = QueryState<T> & {
  /** Load again. Keeps the current data on screen until the new data lands. */
  reload: () => void;
  /** Replace the data (e.g. with what a save returned) without a request. */
  setData: (data: T) => void;
};

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

export function useNurseQuery<T>(
  load: (api: NurseApi) => Promise<T>,
  deps: DependencyList = [],
  options: { pollMs?: number } = {},
): QueryResult<T> {
  const api = useNurseApi();
  const { sessionExpired } = useAuth();
  const [state, setState] = useState<QueryState<T>>({
    status: 'loading',
    data: undefined,
    error: undefined,
  });
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    loadRef.current(api).then(
      (data) => {
        if (!cancelled) setState({ status: 'success', data, error: undefined });
      },
      (error: unknown) => {
        if (cancelled) return;
        if (isSessionError(error)) sessionExpired();
        // A background refresh that fails keeps what she already sees.
        setState((current) =>
          current.status === 'success'
            ? current
            : { status: 'error', data: undefined, error: toError(error) },
        );
      },
    );
    return () => {
      cancelled = true;
    };
    // Callers control re-runs via `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, version, sessionExpired, ...deps]);

  const { pollMs } = options;
  useEffect(() => {
    if (!pollMs) return;
    const timer = window.setInterval(() => {
      // Only while the screen is visible: no background polling on a locked phone.
      if (document.visibilityState !== 'hidden') setVersion((v) => v + 1);
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback(
    (data: T) => setState({ status: 'success', data, error: undefined }),
    [],
  );
  return { ...state, reload, setData };
}

export interface PagedResult<T> {
  status: 'loading' | 'success' | 'error';
  items: T[];
  error: Error | undefined;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: Error | undefined;
  loadMore: () => void;
  reload: () => void;
}

/** Cursor-paged list (`Page<T> = { items, nextCursor }`). */
export function useNursePaged<T>(
  load: (api: NurseApi, cursor: string | undefined) => Promise<Page<T>>,
  deps: DependencyList = [],
): PagedResult<T> {
  const api = useNurseApi();
  const { sessionExpired } = useAuth();
  const [status, setStatus] = useState<PagedResult<T>['status']>('loading');
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState<Error>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error>();
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    generation.current++;
    loadRef.current(api, undefined).then(
      (page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setError(undefined);
        setLoadMoreError(undefined);
        setStatus('success');
      },
      (reason: unknown) => {
        if (cancelled) return;
        if (isSessionError(reason)) sessionExpired();
        setError(toError(reason));
        setStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, version, sessionExpired, ...deps]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    setLoadMoreError(undefined);
    loadRef
      .current(api, nextCursor)
      .then(
        (page) => {
          if (generation.current !== current) return;
          setItems((previous) => [...previous, ...page.items]);
          setNextCursor(page.nextCursor);
        },
        (reason: unknown) => {
          if (generation.current === current) setLoadMoreError(toError(reason));
        },
      )
      .finally(() => {
        if (generation.current === current) setLoadingMore(false);
      });
  }, [api, nextCursor, loadingMore]);

  const reload = useCallback(() => {
    setLoadingMore(false);
    setVersion((v) => v + 1);
  }, []);

  return {
    status,
    items,
    error,
    hasMore: nextCursor !== null,
    loadingMore,
    loadMoreError,
    loadMore,
    reload,
  };
}

/** The current time, ticking every `everyMs` (for countdowns). */
export function useNow(everyMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}
