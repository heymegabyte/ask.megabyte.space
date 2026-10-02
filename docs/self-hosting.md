# Ask — Self-Hosting

Ask is MIT licensed and self-hostable on your own Cloudflare account. **Self-hosting includes
private rooms with no Ask subscription** — privacy is a capability of the software, not a hosted
paywall (see `decisions/0001-license-mit.md`). The $10/month charge is a policy of the hosted
service at ask.megabyte.space only.

## What you need

- A Cloudflare account (Workers Paid is recommended for Durable Objects; the free loop uses
  Workers + Durable Objects + D1).
- Node ≥ 22 and pnpm 11.
- `wrangler` (bundled as a dev dependency in `apps/ask`).

## Steps

1. **Clone + install**

   ```sh
   git clone https://github.com/heymegabyte/ask.megabyte.space.git
   cd ask.megabyte.space
   pnpm install
   ```

2. **Create the D1 registry** and paste its id into `apps/ask/wrangler.jsonc`
   (`d1_databases[0].database_id`, replacing `REPLACE_WITH_D1_ID`).

   ```sh
   pnpm --filter @ask/app exec wrangler d1 create ask-registry
   ```

3. **Apply migrations** (creates `slugs`, `rooms`, `billing_events`, `billing`).

   ```sh
   pnpm --filter @ask/app exec wrangler d1 migrations apply ask-registry --remote
   ```

4. **Set your origin.** In `apps/ask/wrangler.jsonc`, set `vars.SERVICE_ORIGIN` to your deployed
   URL (e.g. `https://ask.example.com`). The Durable Object migration (`ROOM`) and the
   `run_worker_first` asset config are already wired — do not remove them.

5. **Build + deploy.**

   ```sh
   pnpm build
   pnpm --filter @ask/app deploy
   ```

6. **Verify live** per `verification.md` (health, noindex, create-a-room round trip). A deploy
   that succeeds can still mis-serve — always HTTP-verify.

## Optional — private rooms, shared login, billing

The free loop needs none of these. To match the hosted feature set:

- **Shared login (Increment 3):** point `SHARED_AUTH_ISSUER` at your own OAuth 2.1 / OIDC issuer
  (default is `https://projectsites.dev`). Standard redirect OAuth + PKCE; see
  `auth-integration.md`. Do not rely on Better Auth (dark-flagged).
- **Billing (Increment 3):** set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`
  via `wrangler secret put`. If you self-host, you may skip billing entirely and still offer
  private rooms — the code has no license gate. The hosted `$10/month` is a deployment policy you
  are free not to run.

   ```sh
   pnpm --filter @ask/app exec wrangler secret put STRIPE_SECRET_KEY
   pnpm --filter @ask/app exec wrangler secret put STRIPE_PRICE_ID
   pnpm --filter @ask/app exec wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

## What's not in the box yet

Native MCP (`/mcp` → `501`), the fleshed-out agent-integration kit, and all R2 / Queues /
Workflows / Workers-AI enrichment are later increments (`capability-matrix.md`). The free
ask→answer→apply loop is complete and self-hostable today.

## Discovery stays off

Self-hosted or hosted, every response is `noindex` and there is no public room directory
(`privacy.md`). Keep it that way unless you deliberately change it — rooms are meant to be shared
by link, not found by search.
