import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';

const COLLECTION_PATH = 'docs/postman/carelayer.postman_collection.json';

/** Finds the collection from the repo root or from an app folder (npm -w runs in apps/<app>). */
function readCollection(): string {
  for (const base of [
    process.cwd(),
    resolve(process.cwd(), '..'),
    resolve(process.cwd(), '../..'),
  ]) {
    const file = resolve(base, COLLECTION_PATH);
    if (existsSync(file)) return readFileSync(file, 'utf8');
  }
  throw new Error(`Postman collection not found (${COLLECTION_PATH})`);
}

/*
 * Contract-test helpers: compare the routes a frontend HTTP client calls with the
 * routes documented in the Postman collection.
 *
 * Source of truth: the published docs, https://documenter.getpostman.com/view/44554019/2sBYPv3YMs
 * `docs/postman/carelayer.postman_collection.json` is the same collection (checked request
 * by request in the API audit, docs/API_AUDIT.md). Keep it in sync when the docs change.
 */

/** "POST /nurse/questions/:param/claim". Path parameters become ":param", query strings are dropped. */
export type Route = `${string} /${string}`;

interface PostmanItem {
  item?: PostmanItem[];
  request?: { method: string; url: string | { raw?: string } };
}

/** Every documented method + path. */
export function documentedRoutes(): Set<Route> {
  const collection = JSON.parse(readCollection()) as { item: PostmanItem[] };
  const routes = new Set<Route>();
  const walk = (items: PostmanItem[]) => {
    for (const item of items) {
      if (item.item) walk(item.item);
      if (!item.request) continue;
      const { method, url } = item.request;
      const raw = typeof url === 'string' ? url : (url.raw ?? '');
      const path = raw
        .replace('{{baseUrl}}', '')
        .split('?')[0]!
        .replace(/\{\{[^}]+\}\}/g, ':param');
      routes.add(`${method} ${path}` as Route);
    }
  };
  walk(collection.item);
  return routes;
}

/** A value that works as any argument: an id, a body, a query or a file. */
const PARAM = 'p1';

/**
 * Call every function on an API client (recursively) against a stubbed fetch and
 * record the method + path of each request. Ids are passed as "p1", so they show
 * up as ":param" like the documented paths.
 */
export async function calledRoutes(client: object): Promise<Set<Route>> {
  const seen = new Set<Route>();
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname
      .split('/')
      .map((segment) => (segment === PARAM ? ':param' : segment))
      .join('/');
    seen.add(`${init?.method ?? 'GET'} ${path}` as Route);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    const file = new File(['%PDF-1.7'], 'doc.pdf', { type: 'application/pdf' });
    const visit = async (value: unknown): Promise<void> => {
      if (!value || typeof value !== 'object') return;
      for (const member of Object.values(value)) {
        if (typeof member === 'function') {
          // (id), (body), (query), (id, body), (type, file): one shape fits all of them.
          await Promise.resolve(member(PARAM, file)).catch(() => undefined);
        } else {
          await visit(member);
        }
      }
    };
    await visit(client);
  } finally {
    vi.unstubAllGlobals();
  }
  return seen;
}
