import { useCallback, useRef, useState } from 'react';
import type { CareLayerApi } from '../../../api/types';
import { useApi } from '../../../api/useApi';
import { useApiQuery } from '../../../api/useApiQuery';

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving'; field: string }
  | { status: 'saved'; field: string }
  | { status: 'error'; field: string; error: unknown };

/**
 * A settings object loaded with GET and changed with PATCH (contract §3:
 * /me/settings, /me/notifications). Changes show at once; if the save fails the
 * control goes back to the saved value and `saveState` says why.
 * Only the latest save's response is applied, so quick taps cannot be undone
 * by an older response arriving late.
 */
export function useSavedResource<T extends object>(
  load: (api: CareLayerApi) => Promise<T>,
  save: (api: CareLayerApi, patch: Partial<T>) => Promise<T>,
) {
  const api = useApi();
  const query = useApiQuery(load);
  const [saved, setSaved] = useState<T>();
  const [pending, setPending] = useState<T>();
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const latest = useRef(0);

  const current = pending ?? saved ?? query.data;

  const update = useCallback(
    async (field: string, patch: Partial<T>) => {
      if (!current) return false;
      const request = ++latest.current;
      setPending({ ...current, ...patch });
      setSaveState({ status: 'saving', field });
      try {
        const result = await save(api, patch);
        if (request !== latest.current) return true;
        setSaved(result);
        setPending(undefined);
        setSaveState({ status: 'saved', field });
        return true;
      } catch (error) {
        if (request !== latest.current) return false;
        setPending(undefined);
        setSaveState({ status: 'error', field, error });
        return false;
      }
    },
    [api, current, save],
  );

  return {
    status: query.status,
    error: query.error,
    reload: query.reload,
    /** Freshly loaded value (before any change this visit). */
    loaded: query.data,
    current,
    update,
    saveState,
  };
}
