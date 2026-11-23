// One JSON line per event, with a Cloud Logging severity (Z11).
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/lib/logger.js';

describe('logger', () => {
  it('writes one JSON line with level, Cloud Logging severity, event and fields', () => {
    const lines: { level: string; line: string }[] = [];
    const log = createLogger('info', (level, line) => lines.push({ level, line }));
    log.debug('hidden');
    log.info('api_listening', { port: 8080 });
    log.warn('payout_failed', { payoutId: 'p1' });
    log.error('boom');

    expect(lines.map((l) => l.level)).toEqual(['info', 'warn', 'error']);
    const parsed = lines.map((l) => JSON.parse(l.line));
    expect(parsed[0]).toMatchObject({
      level: 'info',
      severity: 'INFO',
      event: 'api_listening',
      port: 8080,
    });
    expect(parsed[1]).toMatchObject({ severity: 'WARNING', payoutId: 'p1' });
    expect(parsed[2].severity).toBe('ERROR');
    expect(typeof parsed[0].time).toBe('string');
  });
});
