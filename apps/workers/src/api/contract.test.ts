import { createHttpApi } from '@web/api/http/http-api';
import { calledRoutes, documentedRoutes, type Route } from '@web/test/postman-contract';
import { DOCUMENTED_NOT_FOR_BROWSER, NOT_DOCUMENTED_BUT_SERVED } from '@web/test/route-exceptions';
import { describe, expect, it } from 'vitest';
import { createHttpNurseApi } from './http-api';

/*
 * Contract test for the nurse app, plus platform coverage: every documented route
 * (https://documenter.getpostman.com/view/44554019/2sBYPv3YMs) is either called by one of
 * the two browser apps, not meant for a browser, or listed below as not built yet.
 * Audit: docs/API_AUDIT.md.
 */

/**
 * Documented, served by apps/api, and wanted by a screen, but not called by either client yet.
 * H10 (POST /chat, /chat/draft) and H11 (the nurse workspace) are merged, so only the Claude
 * connection routes remain. Entries can only be removed: the test checks the uncalled routes
 * are a subset of this list, so it keeps passing as features land.
 */
const NOT_YET_CALLED: ReadonlySet<Route> = new Set<Route>([
  // Women's app: "Use CareLayer in Claude" has no screen yet (docs/QUESTIONS.md Q3e, Q5c.4)
  'POST /auth/agent-tokens',
  'GET /auth/agent-tokens',
  'DELETE /auth/agent-tokens/:param',
]);

describe('nurse app HTTP client vs the Postman docs', () => {
  it('calls only documented routes (or listed exceptions)', async () => {
    const documented = documentedRoutes();
    const called = await calledRoutes(createHttpNurseApi('http://api.test'));
    expect(called.size).toBeGreaterThan(8);
    const unexpected = [...called].filter(
      (route) => !documented.has(route) && !NOT_DOCUMENTED_BUT_SERVED.has(route),
    );
    expect(unexpected).toEqual([]);
  });
});

describe('platform coverage of the Postman docs', () => {
  it('every documented route is called, not for a browser, or listed as not built yet', async () => {
    const documented = documentedRoutes();
    const web = await calledRoutes(createHttpApi('http://api.test'));
    const nurse = await calledRoutes(createHttpNurseApi('http://api.test'));
    const uncovered = [...documented].filter(
      (route) =>
        !web.has(route) &&
        !nurse.has(route) &&
        !DOCUMENTED_NOT_FOR_BROWSER.has(route) &&
        !NOT_YET_CALLED.has(route),
    );
    expect(uncovered).toEqual([]);
  });

  it('the not-built list names only documented routes', () => {
    const documented = documentedRoutes();
    expect([...NOT_YET_CALLED].filter((route) => !documented.has(route))).toEqual([]);
    expect([...DOCUMENTED_NOT_FOR_BROWSER].filter((route) => !documented.has(route))).toEqual([]);
  });
});
