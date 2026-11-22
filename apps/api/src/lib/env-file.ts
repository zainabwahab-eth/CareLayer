// Fill values in a local .env file WITHOUT ever overwriting one that is already set.
// Used by scripts/testnet-setup.ts to store generated testnet keys. Keeps comments and order.

export type FillResult = { key: string; action: 'filled' | 'appended' | 'kept' };

/** Returns the new file text and what happened to each key. Pure: no file IO. */
export function fillEnv(
  text: string,
  values: Record<string, string>,
): { text: string; results: FillResult[] } {
  const lines = text.split(/\r?\n/);
  const results: FillResult[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid env key: ${key}`);
    if (/[\r\n]/.test(value)) throw new Error(`Value for ${key} contains a newline`);
    const index = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (index === -1) {
      lines.push(`${key}=${value}`);
      results.push({ key, action: 'appended' });
    } else if (lines[index]!.replace(/^[^=]*=/, '').trim() === '') {
      lines[index] = `${key}=${value}`;
      results.push({ key, action: 'filled' });
    } else {
      results.push({ key, action: 'kept' });
    }
  }
  return { text: lines.join('\n'), results };
}

const KEY_LINE = /^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/;

export const EXTRA_KEYS_HEADER =
  '# --- Not in .env.example (kept by env:sync; delete if you no longer need them) ---';

export interface SyncResult {
  text: string;
  /** Keys taken from your .env (your value kept, even if empty). */
  kept: string[];
  /** Keys your .env did not have: added with the example's default value. */
  added: string[];
  /** Keys that were empty in your .env while the example has a default: filled with it. */
  filled: string[];
  /** Keys in your .env that the example no longer has: moved to the bottom section. */
  extra: string[];
}

/**
 * Rebuilds a .env in .env.example's order and comments, keeping every value already set.
 * An EMPTY value gets the example's default when the example has one (defaults in the example are
 * never secrets). Never drops a key: ones the example does not know go under EXTRA_KEYS_HEADER.
 * Pure: no file IO, and idempotent (syncing the result again changes nothing).
 */
export function syncEnvWithExample(example: string, env: string): SyncResult {
  const values = new Map<string, string>();
  for (const line of env.split(/\r?\n/)) {
    const m = KEY_LINE.exec(line);
    if (m && !values.has(m[1]!)) values.set(m[1]!, m[2]!);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const kept: string[] = [];
  const added: string[] = [];
  const filled: string[] = [];
  for (const line of example.split(/\r?\n/)) {
    const m = KEY_LINE.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const key = m[1]!;
    if (seen.has(key)) continue;
    seen.add(key);
    if (values.has(key) && values.get(key)!.trim() === '' && m[2]!.trim() !== '') {
      out.push(`${key}=${m[2]!}`);
      filled.push(key);
    } else if (values.has(key)) {
      out.push(`${key}=${values.get(key)}`);
      kept.push(key);
    } else {
      out.push(`${key}=${m[2]!}`);
      added.push(key);
    }
  }

  const extra = [...values.keys()].filter((k) => !seen.has(k));
  while (out.length && out[out.length - 1]!.trim() === '') out.pop();
  if (extra.length) {
    out.push('', EXTRA_KEYS_HEADER);
    for (const key of extra) out.push(`${key}=${values.get(key)}`);
  }
  return { text: out.join('\n') + '\n', kept, added, filled, extra };
}

/** Reads KEY=value pairs (no expansion, no quotes handling beyond trimming). */
export function readEnvValue(text: string, key: string): string | undefined {
  const line = text.split(/\r?\n/).find((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  const value = line?.replace(/^[^=]*=/, '').trim();
  return value ? value : undefined;
}
