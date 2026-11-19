// Minimal structured logger: one JSON line per event on stdout/stderr.
// Privacy: never pass request bodies, question text, emails or tokens to the logger.
import type { LogLevel } from '../config.js';

type Level = Exclude<LogLevel, 'silent'>;
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export type LogSink = (level: Level, line: string) => void;

const defaultSink: LogSink = (level, line) => {
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
};

export function createLogger(minLevel: LogLevel, sink: LogSink = defaultSink): Logger {
  const log =
    (level: Level) =>
    (event: string, fields: LogFields = {}) => {
      if (ORDER[level] < ORDER[minLevel]) return;
      sink(level, JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
    };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}
