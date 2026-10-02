-- D1 registry: unique slug mappings + immutable room-id index (§11).
-- Full Q&A is NOT duplicated here — it lives in each room's Durable Object.

CREATE TABLE IF NOT EXISTS slugs (
  slug         TEXT PRIMARY KEY,     -- normalized, uniqueness enforced by storage (§4)
  room_id      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active', -- active | alias | provisional
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id          TEXT PRIMARY KEY, -- immutable, independent of slug (§12)
  current_slug     TEXT NOT NULL,
  owner_principal  TEXT NOT NULL,    -- sha256 of the anonymous browser session capability (§4)
  visibility       TEXT NOT NULL DEFAULT 'public',
  creation_state   TEXT NOT NULL DEFAULT 'active', -- provisional | active | expired
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slugs_room ON slugs (room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms (owner_principal);

-- Billing-event inbox (§15) — idempotent webhook processing.
CREATE TABLE IF NOT EXISTS billing_events (
  event_id     TEXT PRIMARY KEY,
  room_id      TEXT,
  type         TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  payload      TEXT
);

-- Server-derived billing/entitlement state per room (§15).
CREATE TABLE IF NOT EXISTS billing (
  room_id             TEXT PRIMARY KEY,
  customer_id         TEXT,
  subscription_id     TEXT,
  entitlement         TEXT NOT NULL DEFAULT 'none',
  requested_visibility TEXT NOT NULL DEFAULT 'public',
  paid_through        TEXT,
  grace_until         TEXT,
  updated_at          TEXT NOT NULL
);
