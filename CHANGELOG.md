# Changelog

All notable changes to Ask are recorded here. Format: [Keep a Changelog](https://keepachangelog.com);
this project follows [Semantic Versioning](https://semver.org).

## [0.1.0] — 2026-10-01

Increment 1 — the core free loop, plus the full project documentation set.

### Added

- **Monorepo scaffold.** Single deployable Cloudflare app `apps/ask/` (React SPA + Hono Worker,
  one origin via `@cloudflare/vite-plugin`), `packages/contracts` (Zod SSOT), and
  `packages/agent-integration` (scaffold).
- **Zod contracts** (`packages/contracts`) — entities, request/response schemas, the event model,
  the route manifest, and starting limits; every side infers its types from these.
- **Room Durable Object** — one SQLite-backed DO per room, authoritative for questions (dedup by
  `dedupKey`), append-only answer revisions, application receipts, agent enrollment + token
  verification, the monotonic event log, visibility epoch, and hibernatable WebSockets.
- **D1 registry** (`ask-registry`) — unique slug→room mapping, immutable room-id index, and the
  billing inbox; Q&A is never duplicated into D1.
- **Create/claim rooms** with atomic unique-slug claims and memorable word-based slug generation
  (reserved + offensive screening).
- **Anonymous owner model** — host-only HttpOnly session cookie; owner principal = SHA-256 of the
  capability; owner vs guest resolved per request.
- **Agent integration surface** — enrollment returns a scoped bearer token; receipts require it;
  authored questions are stamped. Agent auth grants no admin power.
- **Real-time** — cursor delta feed + WebSocket live events with hibernation and
  snapshot-or-replay reconnect.
- **Discovery off** — `X-Robots-Tag: noindex` on every response, `no-store` on `/api/*`; no public
  directory or sitemap.
- **Honest boundaries** — `GET /api/health`, versioned `/integrations/manifest.json`; billing
  (`/checkout`, Stripe webhook) and native MCP (`/mcp`) return `501` with a note naming their
  increment rather than a stub.
- **Documentation set** (`docs/`) — plan, capability matrix, protocol, architecture, ADRs
  0001–0005, auth integration, self-hosting, deployment, privacy, and the verification
  acceptance-gate checklist. Repo `README`, `CHANGELOG`, `TODO`.

### Not yet (tracked in `TODO.md` / `docs/capability-matrix.md`)

- Private rooms + shared OAuth login (projectsites.dev issuer, PKCE) + Stripe billing — Increment 3.
- Fleshed-out agent-integration kit + host adapters — Increment 2.
- Native MCP — Increment 4.
- R2 / Queues / Workflows / Workers AI enrichment — Increment 5.

[0.1.0]: https://github.com/heymegabyte/questionl.ink/releases/tag/v0.1.0
