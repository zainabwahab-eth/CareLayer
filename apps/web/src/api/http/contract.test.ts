import { describe, expect, it } from 'vitest';
import { calledRoutes, documentedRoutes } from '../../test/postman-contract';
import { NOT_DOCUMENTED_BUT_SERVED } from '../../test/route-exceptions';
import { createHttpApi } from './http-api';

/*
 * Contract test: every route the women's app calls must be in the published Postman docs
 * (https://documenter.getpostman.com/view/44554019/2sBYPv3YMs), or be a listed exception.
 * Audit: docs/API_AUDIT.md.
 */

describe("women's app HTTP client vs the Postman docs", () => {
  it('calls only documented routes (or listed exceptions)', async () => {
    const documented = documentedRoutes();
    const called = await calledRoutes(createHttpApi('http://api.test'));
    expect(called.size).toBeGreaterThan(20);
    const unexpected = [...called].filter(
      (route) => !documented.has(route) && !NOT_DOCUMENTED_BUT_SERVED.has(route),
    );
    expect(unexpected).toEqual([]);
  });

  it('listed exceptions are really undocumented (drop them once Postman documents them)', () => {
    const documented = documentedRoutes();
    expect([...NOT_DOCUMENTED_BUT_SERVED].filter((route) => documented.has(route))).toEqual([]);
  });
});
