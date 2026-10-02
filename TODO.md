# TODO — Ask Roadmap

Increment 1 (core free loop) is done. This is the roadmap for Increments 2–5. Status reference:
`docs/capability-matrix.md`. Build order rationale: `docs/plan.md`.

## Increment 2 — Agent integration kit

- [ ] `packages/agent-integration`: typed HTTP helper (enroll · publish questions · poll changes
      · post receipts) importing `@ask/contracts`; respect `minPollIntervalMs` (15s).
- [ ] Host adapters + project-skill files: Claude Code (hooks: SessionStart, UserPromptSubmit,
      throttled PostToolUse, Stop), Codex, Cursor, Gemini CLI, OpenCode, generic HTTP fallback.
- [ ] Populate manifest `files[]` with SHA-256-pinned adapter artifacts; flip `verified` per host
      only after a real integration test.
- [ ] Contract tests against the live REST surface; fixtures in `packages/agent-integration`.
- [ ] Wire `/rooms/:id/context-requests` handler (schema exists; route unbuilt).

## Increment 3 — Private rooms, shared auth, billing

- [ ] Shared-auth adapter: redirect OAuth/OIDC + PKCE (S256) vs `https://projectsites.dev`;
      identity = issuer+subject; host-only Ask session cookie. Behind a provider interface.
- [ ] Contract tests for the auth adapter; then live-verify the full authorize→token→cookie→owner
      round trip before calling it LIVE.
- [ ] Owner-facing visibility toggle route (DO `setVisibility` exists; no route yet).
- [ ] Wire `/rooms/:id/claim` handler (route constant exists; unbuilt).
- [ ] Stripe checkout: `POST .../checkout` → session; USD $10/month per private page; room is the
      entitlement unit.
- [ ] Verified + idempotent Stripe webhook into D1 `billing_events`; derive `billing` state.
- [ ] Enforce entitlement state machine: `none→active→grace→read_only→canceled`; 7-day grace;
      **lapse never flips public** (private read-only).
- [ ] Do NOT depend on Better Auth (`better_auth` dark-flagged, default off).

## Increment 4 — Native MCP

- [ ] Streamable-HTTP MCP at `/mcp` sharing the Room DO domain functions with REST (one authority).
- [ ] MCP tools mirroring REST verbs (enroll · publish questions · snapshot/changes · receipt),
      each with strict Zod input + output schemas.
- [ ] Flip the manifest + `capability-matrix.md` MCP row to LIVE once verified.

## Increment 5 — Enrichment (each behind a feature flag)

- [ ] R2: image-comparison question assets + room exports.
- [ ] Queues + Workflows: async fan-out, owner digests/notifications.
- [ ] Workers AI: question clustering + answer summarization — paired with evals for generation
      quality.
- [ ] Decision interpretation layer: derive normalized `Decision` meaning from answers (schema
      exists; no server derivation yet).

## Cross-cutting (any increment that adds a surface)

- [ ] Every new feature behind a flag (`enabled=0, rollout=0, stage=experimental`).
- [ ] Every new Worker-owned path added to `run_worker_first` in the same change.
- [ ] Playwright spec against the prod URL at 6 breakpoints; axe-core 0 violations.
- [ ] Fill the `docs/verification.md` acceptance gate with real evidence before DONE.
- [ ] Keep `docs/capability-matrix.md` honest — no unverified integration marked LIVE.
