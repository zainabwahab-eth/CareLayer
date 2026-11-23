import { useCallback, useEffect, useState } from 'react';

/**
 * Focus an element after the next render. Needed after a failed request: the
 * inputs are still disabled (saving) when the error arrives, and a disabled
 * input silently ignores focus().
 */
export function useFocusAfterRender() {
  const [request, setRequest] = useState<{ get: () => HTMLElement | null } | null>(null);

  useEffect(() => {
    if (!request) return;
    const el = request.get();
    if (!el) return;
    const target = el instanceof HTMLFieldSetElement ? el.querySelector('button') : el;
    target?.focus();
    el.scrollIntoView?.({ block: 'center' });
  }, [request]);

  return useCallback((get: () => HTMLElement | null) => setRequest({ get }), []);
}
