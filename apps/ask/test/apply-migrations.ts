/**
 * Vitest setup — apply the D1 registry migrations once per isolate before any
 * spec runs. The parsed migrations are handed in via the `TEST_MIGRATIONS`
 * binding (populated in vitest.config.ts from `readD1Migrations`).
 *
 * This gives `env.DB` the `slugs` / `rooms` tables the Worker's create/resolve
 * paths depend on. The Room Durable Object creates its own SQLite tables lazily
 * in its constructor, so no DO migration step is needed here.
 */
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

beforeAll(async () => {
  const migrations = (env as unknown as { TEST_MIGRATIONS?: unknown }).TEST_MIGRATIONS;
  if (Array.isArray(migrations)) {
    await applyD1Migrations(env.DB as D1Database, migrations as never);
  }
});
