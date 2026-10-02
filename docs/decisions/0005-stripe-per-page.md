# 0005 — Stripe billing, USD $10/month per private page

- Status: Accepted (plan) — Increment 3, not yet live
- Date: 2026-10-01

## Context

The hosted service offers private rooms as a paid capability. We must decide the payment rail,
the pricing unit, and — critically — what happens to a private room when payment lapses.

## Decision

- **Rail: Stripe.** Price: **USD $10/month, per private page (room).** The room is the
  entitlement unit.
- **Requested-visibility and paid-entitlement are separate fields** (D1 `billing`:
  `requested_visibility` vs `entitlement`; mirrored in `BillingRecord`). They are never
  conflated.
- **A lapse NEVER flips a room to public.** On failed renewal: 7-day grace (`billingGraceDays`),
  then the room becomes **private read-only** (`EntitlementState.read_only`) — the owner can
  read but not write; it does not become publicly visible.
- The Stripe webhook is verified and idempotent via the D1 `billing_events` inbox.

## Decision (one-way-door check)

- Pricing + the "lapse never leaks" rule are a trust contract — once customers rely on it,
  changing it is a one-way door. Making privacy fail-closed (read-only, never public) is the
  safe default: the worst case of a billing failure must never be a data exposure.
- Rail choice follows the payments routing: a flat recurring subscription for a single digital
  capability is Stripe Billing territory (not Square).

## Consequences

- Entitlement state machine: `none` → `active` → `grace` → `read_only` → (`canceled`). The DO
  honors visibility; billing state drives the entitlement, and the two never contradict in the
  public direction.
- Until `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID` (+ the shared-auth binding) are provisioned,
  `POST .../checkout` and the webhook return an honest `501` — no fake success.
- Self-hosters get private rooms free (see ADR 0001); this billing policy applies only to the
  hosted deployment.
- A privacy downgrade (the owner cancels deliberately) is an owner action, distinct from a
  lapse; it still never auto-publishes existing private content.
