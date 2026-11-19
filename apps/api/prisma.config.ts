// Prisma 7 config. The connection URL lives here (not in schema.prisma).
import { defineConfig } from 'prisma/config';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on the real environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx src/seed/run.ts' },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
