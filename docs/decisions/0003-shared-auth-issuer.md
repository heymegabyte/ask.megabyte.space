# 0003 — Shared auth against the projectsites.dev issuer

- Status: Accepted (plan) — Increment 3, not yet live-verified
- Date: 2026-10-01

## Context

Private rooms need an authenticated owner identity beyond the anonymous cookie principal used
for the free loop. Megabyte already runs an OAuth 2.1 authorization server at
`https://projectsites.dev`.

## Decision

- **Issuer = `https://projectsites.dev`** (set as `SHARED_AUTH_ISSUER`). Verified locally this
  session: it is an OAuth 2.1 AS exposing metadata at
  `/.well-known/oauth-authorization-server` with `/oauth/authorize|token|register` and PKCE
  S256. **Identity = issuer + subject.**
- **Private-auth plan: standard redirect OAuth/OIDC + PKCE (S256)** against that issuer, with a
  host-only Ask session cookie after the handshake. This is Increment 3 — shipped as an adapter
  plus contract tests first; it is NOT yet live-verified.
- **Do NOT depend on Better Auth.** Better Auth exists but is dark-flagged (`better_auth`
  default off). No code path may require it.

## Consequences

- The anonymous owner model (SHA-256 of a host-only cookie) stays as the Increment 1 baseline;
  shared-auth login layers on top for private rooms, it does not replace it.
- Because identity is issuer + subject, an Ask account is portable across any Megabyte surface
  sharing that issuer.
- "Verified the issuer exposes AS metadata" is NOT "login works." Until the adapter is
  live-verified, `auth-integration.md` and `capability-matrix.md` list shared-auth as
  ADAPTER+CONTRACT-TESTS-ONLY. Do not describe it as live.
- Build the adapter behind an interface so the login provider is swappable without touching
  room logic.
