// Fixed red-flag list (apps/api/config/red-flags.json, owned by Hikmah). Checked BEFORE the LLM on
// every chat message, draft and question. Loaded and validated at startup: a broken file stops the
// API instead of silently switching the safety net off.
//
// Matching (as the file documents): case-insensitive substring of the message. Both sides are
// normalised the same way first: lowercase, curly quotes to straight, runs of whitespace to one
// space. Deterministic and free, so it runs even when the LLM is down.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const RED_FLAGS_PATH = fileURLToPath(
  new URL('../../../config/red-flags.json', import.meta.url),
);

const RedFlagFileSchema = z.object({
  flags: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        patterns: z.array(z.string().trim().min(3)).min(1),
        category: z.string().optional(),
      }),
    )
    .min(1),
});

export interface RedFlag {
  id: string;
  label: string;
  /** Normalised. */
  patterns: string[];
}

export function normaliseForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRedFlags(json: unknown): RedFlag[] {
  const file = RedFlagFileSchema.parse(json);
  const ids = new Set<string>();
  return file.flags.map((f) => {
    if (ids.has(f.id)) throw new Error(`Duplicate red-flag id: ${f.id}`);
    ids.add(f.id);
    return { id: f.id, label: f.label, patterns: f.patterns.map(normaliseForMatching) };
  });
}

export function loadRedFlags(path = RED_FLAGS_PATH): RedFlag[] {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read red flags at ${path}: ${(err as Error).message}`, { cause: err });
  }
  return parseRedFlags(json);
}

/** Ids of every flag with a pattern inside the text. Empty = no fixed-list match. */
export function matchRedFlags(flags: RedFlag[], text: string): string[] {
  const haystack = normaliseForMatching(text);
  return flags.filter((f) => f.patterns.some((p) => haystack.includes(p))).map((f) => f.id);
}
