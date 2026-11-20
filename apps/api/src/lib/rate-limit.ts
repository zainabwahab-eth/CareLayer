// Small in-memory sliding-window limiter, per key (e.g. user id). Protects the LLM key's rate limit
// (NVIDIA's free tier allows about 40 requests a minute for the whole app) from one busy client.
// Per process: fine for one API instance; a multi-instance deploy would move this to Postgres.
import { AppError } from './errors.js';

export interface RateLimiter {
  /** Throws 429 RATE_LIMITED when the key is over its limit; otherwise counts this hit. */
  hit(key: string): void;
}

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => Date;
}): RateLimiter {
  const hits = new Map<string, number[]>();
  const now = () => (opts.now ?? (() => new Date()))().getTime();
  return {
    hit(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < opts.windowMs);
      if (recent.length >= opts.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((recent[0]! + opts.windowMs - t) / 1000));
        hits.set(key, recent);
        throw new AppError(429, 'RATE_LIMITED', 'Too many messages at once. Wait a moment.', {
          retryAfterSeconds,
        });
      }
      recent.push(t);
      hits.set(key, recent);
      // Keep the map from growing forever: drop keys with no recent hits now and then.
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (!v.some((at) => t - at < opts.windowMs)) hits.delete(k);
      }
    },
  };
}
