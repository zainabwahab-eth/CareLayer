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

/** Reads KEY=value pairs (no expansion, no quotes handling beyond trimming). */
export function readEnvValue(text: string, key: string): string | undefined {
  const line = text.split(/\r?\n/).find((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  const value = line?.replace(/^[^=]*=/, '').trim();
  return value ? value : undefined;
}
