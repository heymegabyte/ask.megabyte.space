# 0001 — License: MIT

- Status: Accepted
- Date: 2026-10-01

## Context

Ask is a free, open-source Cloudflare service. We must pick a license for the new code, and
decide how "free/open-source" relates to the paid private-page subscription.

## Decision

- **New code is MIT licensed** (`LICENSE`, and `license: "MIT"` in every `package.json`).
- **Self-hosting on your own Cloudflare account includes private pages** with no Ask
  subscription. Privacy is a capability of the software; anyone running their own instance gets
  it for free.
- **The USD $10/month private-page subscription is a server-side deployment policy of the
  hosted service at fuegol.ink — not a client flag or a licensed feature.** The code
  contains no license gate; the hosted deployment chooses to require Stripe entitlement before
  provisioning a private room. A self-hoster simply doesn't run that policy.

## Consequences

- MIT is maximally permissive — fork, embed, sell. That is intended; distribution beats
  control for an agent-integration tool whose value grows with adoption.
- There is no "open-core" split in the repo. Do NOT add a license check that disables private
  rooms in self-hosted builds — that would contradict this decision. The ONLY thing gating
  private rooms on the hosted service is the billing policy wired in Increment 3.
- Hosted-vs-self-hosted parity: a self-hoster can offer private rooms however they like; the
  hosted service monetizes convenience + hosting, not a code capability.
