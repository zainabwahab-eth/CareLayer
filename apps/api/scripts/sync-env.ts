// Brings apps/api/.env in line with .env.example, keeping every value you have set.
//
//   npm run env:sync -w @carelayer/api
//
// - Same order and comments as .env.example; new keys get the example's default.
// - Keys the example no longer has are kept at the bottom, never deleted.
// - Backs up the old file to .env.bak first (gitignored). Prints key NAMES only, never values.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { syncEnvWithExample } from '../src/lib/env-file.js';

const dir = resolve(import.meta.dirname, '..');
const envPath = resolve(dir, '.env');
const examplePath = resolve(dir, '.env.example');

const example = readFileSync(examplePath, 'utf8');
if (!existsSync(envPath)) {
  writeFileSync(envPath, example);
  console.log('[env:sync] no .env yet: created it from .env.example. Fill in the secrets.');
  process.exit(0);
}

const current = readFileSync(envPath, 'utf8');
const result = syncEnvWithExample(example, current);
if (result.text === current) {
  console.log('[env:sync] .env already matches .env.example. Nothing to do.');
  process.exit(0);
}

copyFileSync(envPath, resolve(dir, '.env.bak'));
writeFileSync(envPath, result.text);
console.log('[env:sync] backup: apps/api/.env.bak');
console.log(`[env:sync] kept your value for ${result.kept.length} keys`);
if (result.added.length) console.log(`[env:sync] added with defaults: ${result.added.join(', ')}`);
if (result.filled.length) {
  console.log(`[env:sync] were empty, filled with defaults: ${result.filled.join(', ')}`);
}
if (result.extra.length) {
  console.log(`[env:sync] not in .env.example (moved to the bottom): ${result.extra.join(', ')}`);
}
