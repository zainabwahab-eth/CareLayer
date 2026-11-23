import type { Page } from '@carelayer/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DependencyList,
} from 'react';
import type { CareLayerApi } from './types';
import { useApi } from './useApi';

export interface PagedQueryResult<T> {
  /** State of the first page. Later pages never put the list back into "loading". */
  status: 'loading' | 'success' | 'error';
  items: T[];
  error: Error | undefined;
  hasMore: boolean;
  loadingMore: boolean;
  /** Failure of the last "load more"; the items already shown stay. */
  loadMoreError: Error | undefined;
  loadMore: () => void;
  /** Start again from the first page (keeps showing the current items until it lands). */
  reload: () => void;
}

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

/**
 * Cursor-paged list (contract §0 "Lists": `Page<T> = { items, nextCursor }`).
 *
 *   const txs = usePagedQuery((api, cursor) => api.wallet.listTransactions({ cursor }));
 */
export function usePagedQuery<T>(
  load: (api: CareLayerApi, cursor: string | undefined) => Promise<Page<T>>,
  deps: DependencyList = [],
): PagedQueryResult<T> {
  const api = useApi();
  const [status, setStatus] = useState<PagedQueryResult<T>['status']>('loading');
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState<Error>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error>();
  const [version, setVersion] = useState(0);
  // Bumped on every (re)load so late "load more" responses from an older list are dropped.
  const generation = useRef(0);
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    // A new list: any "load more" still in flight belongs to the old one.
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
        setError(toError(reason));
        setStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
    // Callers control re-runs via `deps`, like useApiQuery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, version, ...deps]);

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
