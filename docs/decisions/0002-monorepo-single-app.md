# 0002 — Monorepo with a single deployable app

- Status: Accepted
- Date: 2026-10-01

## Context

Ask has a React SPA and a Cloudflare Worker that must be same-origin (the browser session
cookie is host-only, and `protocol.md` requires one origin for SPA + API). We need a repo
layout that keeps the SPA, the Worker, and the shared Zod contracts coherent.

## Decision

A pnpm workspace with:

- `apps/ask/` — the single deployable Cloudflare app: React SPA (`src/`) + Worker (`worker/`),
  unified by `@cloudflare/vite-plugin`, served from one origin.
- `packages/contracts/` — Zod single source of truth (entities, routes, events, limits).
- `packages/agent-integration/` — the agent HTTP helper + host adapters (scaffold today).

## Decision (one-way-door check)

Splitting into `apps/web` + `apps/worker` is the obvious alternative. Argument against it, and
why this is close to a one-way door for the origin model:

- The CF Vite plugin already unifies the SPA build and the Worker into one deploy artifact, so a
  split would add a second deploy target and a cross-origin seam for no benefit.
- `protocol.md` requires same-origin (host-only `ask_sid` cookie, `no-store` API, `noindex`
  header applied by the Worker to both API and shell). A split invites a CORS/cookie-domain
  surface that is painful to unwind once clients exist.
- Confidence to proceed as a single app: high. Reversing later (extracting the Worker) is a
  real migration touching routing, cookies, and CSP — hence documented here rather than treated
  as a casual two-way door.

## Consequences

- One `wrangler deploy` ships both halves; one origin; no CORS.
- Contracts are a workspace dependency (`@ask/contracts`) imported by SPA, Worker, and agent kit
  — types never drift because they are inferred from one schema set.
- The layout follows the monorepo convention (deployables under `apps/`, shared code under
  `packages/`), so structure is conventional, not bespoke.
