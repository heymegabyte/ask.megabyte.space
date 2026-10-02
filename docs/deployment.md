# Ask — Deployment

One deployable Cloudflare app (`apps/ask`). The CF Vite plugin builds the SPA and the Worker
into one artifact; `wrangler deploy` ships both to one origin.

## Prerequisites

- Cloudflare account + `wrangler` authenticated (`wrangler whoami`; or `CLOUDFLARE_API_TOKEN` /
  `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`).
- D1 `ask-registry` created and its id set in `apps/ask/wrangler.jsonc`.
- Migrations applied (`wrangler d1 migrations apply ask-registry --remote`).

## Commands

```sh
pnpm build                      # builds packages then the @ask/app SPA + Worker
pnpm --filter @ask/app deploy   # vite build && wrangler deploy
```

Root scripts: `pnpm typecheck` (all packages), `pnpm test` (Vitest), `pnpm test:e2e`
(Playwright), `pnpm lint` (prettier check).

## Config that must stay correct (`wrangler.jsonc`)

- `main: ./worker/index.ts`, `compatibility_date`, `compatibility_flags: ["nodejs_compat"]`.
- `assets`: `binding: ASSETS`, `not_found_handling: single-page-application`, and
  **`run_worker_first: ["/api/*", "/integrations/*", "/mcp", "/mcp/*"]`**. Add any new
  Worker-owned path prefix here in the same change (see the gotcha in `architecture.md`), or the
  asset layer will shadow it for browser navigations.
- `durable_objects.bindings`: `ROOM → RoomDurableObject`; `migrations: [{ tag: "v1",
  new_sqlite_classes: ["RoomDurableObject"] }]`.
- `d1_databases`: `DB → ask-registry` with `migrations_dir: migrations`.
- `observability.enabled: true`.
- `vars`: `SERVICE_ORIGIN` (must match the deployed URL), `SHARED_AUTH_ISSUER`,
  `BILLING_GRACE_DAYS`.

## Secrets (Increment 3 — optional; the free loop runs without them)

```sh
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_PRICE_ID
wrangler secret put STRIPE_WEBHOOK_SECRET
```

Absent these, billing endpoints return an honest `501 billing_not_configured` — never a stub
success.

## Post-deploy (mandatory — a successful deploy is not a working deploy)

Run the smoke recipe in `verification.md` against the live `SERVICE_ORIGIN`. At minimum:

- `GET /api/health` → `200 {status:"ok"}` with `X-Robots-Tag: noindex`.
- `GET /` → `200`, SPA shell paints, zero console errors.
- A real-browser navigation to a room path serves the SPA (not an API 404) — test with
  `Accept: text/html`, not bare curl.
- `GET /api/<bogus>` → JSON `404` (not the SPA shell).
- `POST /api/v1/rooms` → `201` with a canonical room + adopt URL.

## Rollback

- Worker: `wrangler rollback <version-id>`.
- D1: `wrangler d1 time-travel restore` (30-day point-in-time).
- No staging — prod is the only environment, and every deploy is reversible by the above.

## Migrations discipline

- D1 migrations are additive-first; never drop a column in the same migration that adds its
  replacement.
- The DO SQLite schema is created idempotently inside the DO constructor; a new DO class or a
  breaking DO schema change needs a new `migrations` tag in `wrangler.jsonc`.
