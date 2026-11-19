// Runs once per `npm test`:
// 1. Creates a brand-new, empty database named carelayer_<timestamp>_test on the server in DATABASE_URL_TEST.
// 2. Applies every migration with `prisma migrate deploy` (non-destructive). This is the
//    "migrate on a fresh database" check: a broken migration fails the whole suite here.
// 3. Points the test workers at it (process.env.DATABASE_URL_TEST).
// 4. Drops ONLY that throwaway database when the suite finishes.
// Nothing ever resets or drops the dev database or the base test database.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import pg from 'pg';
import { testDatabaseUrl } from './helpers/env.js';

const require = createRequire(import.meta.url);

function withDatabase(url: string, name: string) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function admin<T>(baseUrl: string, fn: (c: pg.Client) => Promise<T>) {
  // Connect to the maintenance database to create / drop the throwaway one.
  const client = new pg.Client({ connectionString: withDatabase(baseUrl, 'postgres') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export default async function setup() {
  const baseUrl = testDatabaseUrl();
  const name = `carelayer_${Date.now()}_${process.pid}_test`;
  if (!/^[a-z0-9_]+_test$/.test(name)) throw new Error(`Unsafe test database name: ${name}`);
  const url = withDatabase(baseUrl, name);

  await admin(baseUrl, (c) => c.query(`CREATE DATABASE "${name}"`));

  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL_TEST = url;

  return async () => {
    await admin(baseUrl, (c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
  };
}
