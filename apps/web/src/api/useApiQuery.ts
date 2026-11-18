import { useCallback, useEffect, useState, type DependencyList } from 'react';
import type { ApiError } from './errors';
import type { CareLayerApi } from './types';
import { useApi } from './useApi';

export type ApiQueryState<T> =
  | { status: 'loading'; data: undefined; error: undefined }
  | { status: 'success'; data: T; error: undefined }
  | { status: 'error'; data: undefined; error: ApiError | Error };

export type ApiQueryResult<T> = ApiQueryState<T> & { reload: () => void };

/**
 * Minimal read hook: runs `load(api)` on mount and when `deps` change,
 * ignores stale responses, and exposes `reload`.
 *
 *   const wallet = useApiQuery((api) => api.wallet.get());
 *
 * Kept deliberately small; swap for a caching library later without changing
 * the CareLayerApi interface.
 */
export function useApiQuery<T>(
  load: (api: CareLayerApi) => Promise<T>,
  deps: DependencyList = [],
): ApiQueryResult<T> {
  const api = useApi();
  const [state, setState] = useState<ApiQueryState<T>>({
    status: 'loading',
    data: undefined,
    error: undefined,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load(api).then(
      (data) => {
        if (!cancelled) setState({ status: 'success', data, error: undefined });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            data: undefined,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // `load` is usually an inline arrow; callers control re-runs via `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, version, ...deps]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
