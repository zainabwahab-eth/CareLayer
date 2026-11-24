/*
 * A hint (not a credential) that this browser had a signed-in session, so the
 * landing page can wait for the session to be restored instead of flashing the
 * marketing page before sending her to Home. The session itself is only ever the
 * httpOnly refresh cookie; this flag just says whether waiting is worthwhile.
 */
const SESSION_HINT_KEY = 'carelayer.session';

export function readSessionHint(): boolean {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false; // Storage blocked: show the landing page straight away.
  }
}

export function writeSessionHint(signedIn: boolean) {
  try {
    if (signedIn) window.localStorage.setItem(SESSION_HINT_KEY, '1');
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Storage blocked: the landing page simply does not wait.
  }
}
