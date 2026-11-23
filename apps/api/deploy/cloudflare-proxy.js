/* global URL, Response, Headers, fetch -- Cloudflare Workers runtime */
// Cloudflare Worker "carelayer-proxy" (Z11): custom domains for the Cloud Run services.
// Cloud Run domain mappings are not available in europe-west2, so Cloudflare (DNS for
// carelayer.health, free plan) serves the custom domains and forwards to Cloud Run.
//
// Deploy: Cloudflare dashboard > Workers & Pages > carelayer-proxy > Edit code > paste > Deploy.
// Domains: the Worker > Settings > Domains & Routes > Custom domain, one for each hostname below
// (Cloudflare creates the DNS records and the certificates).
//
// Forwards every request unchanged (method, path, query, headers, body) and returns the response
// unchanged (CORS headers and the sign-in cookie included).
const ORIGINS = {
  'api.carelayer.health': 'https://carelayer-api-598920525559.europe-west2.run.app',
  'mcp.carelayer.health': 'https://carelayer-mcp-598920525559.europe-west2.run.app',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = ORIGINS[url.hostname];
    if (!origin) return new Response('Not found', { status: 404 });

    const target = new URL(url.pathname + url.search, origin);
    const headers = new Headers(request.headers);
    headers.delete('host'); // Cloud Run must see its own hostname
    headers.set('X-Forwarded-Host', url.hostname);
    headers.set('X-Forwarded-Proto', 'https');

    const init = { method: request.method, headers, redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;

    return fetch(target, init);
  },
};
