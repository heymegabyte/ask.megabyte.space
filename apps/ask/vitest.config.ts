/**
 * Vitest config for the Ask Worker + Room Durable Object.
 *
 * Runs the worker spec suite inside `@cloudflare/vitest-pool-workers` so `SELF`
 * (imported from 'cloudflare:test') dispatches real `fetch` into the actual
 * Worker + Room DO with a real Miniflare D1 + Durable Object, exactly as prod
 * routes them. Each test is hermetic: a fresh room is created per test so no
 * two tests share slug/room state.
 *
 * The D1 schema is applied from ./migrations before the suite via
 * `readD1Migrations` + the test-apply bootstrap in test/apply-migrations.ts.
 */
import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  // Read the registry migrations so D1 (`DB`) has `slugs` / `rooms` tables in-pool.
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));

  return {
    resolve: {
      alias: {
        // The worker imports '@ask/contracts' via workspace; point the pool at source.
        '@ask/contracts': path.join(__dirname, '../../packages/contracts/src/index.ts'),
      },
    },
    test: {
      include: ['test/**/*.spec.ts'],
      // Expose the parsed migrations to the test bootstrap via a bound test value.
      poolOptions: {
        workers: {
          singleWorker: true,
          // NOTE: the production ./wrangler.jsonc (out of scope to edit) uses the
          // ARRAY form of `assets.run_worker_first`, which the pool's pinned
          // bundled wrangler (3.109.1) can't parse. We point the pool at a
          // test-only mirror that drops that single asset-routing key (irrelevant
          // to worker-level SELF.fetch specs) and keeps DB/ROOM/vars/migration.
          wrangler: { configPath: './test/wrangler.vitest.jsonc' },
          miniflare: {
            // Hand the migrations to the isolated storage so `applyD1Migrations` can run them.
            bindings: { TEST_MIGRATIONS: migrations },
            // The pool pins miniflare 3.2025xxxx whose bundled workerd only supports
            // compat dates up to 2025-02-04; the production 2026-09-23 date overflows it
            // and the runtime fails to boot. Pin the test runtime to the supported date —
            // worker + DO behavior under test is unaffected. `nodejs_compat` is kept.
            compatibilityDate: '2025-02-04',
            compatibilityFlags: ['nodejs_compat'],
          },
        },
      },
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
