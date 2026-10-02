# 0004 — One Durable Object per room

- Status: Accepted
- Date: 2026-10-01

## Context

A room's Q&A, append-only answer-revision chain, monotonic event sequence, revision high-water
mark, visibility epoch, and live WebSocket connections must advance consistently and support
real-time fan-out. We must decide where the authoritative room state lives.

## Decision

Each room is one SQLite-backed Durable Object (`RoomDurableObject`), authoritative for all of
the above. D1 (`ask-registry`) holds only the unique slug→room mapping, the immutable room-id
index, and the billing inbox — it never duplicates Q&A.

## Decision (one-way-door check)

Alternative: keep all state in D1 with a pub/sub layer for live updates. Argument against, and
why this is a one-way door (the data model encodes the choice):

- **Serialization.** The event `seq` (AUTOINCREMENT) + room `revision` must be strictly
  monotonic per room. A DO is a single serialized writer; D1 under concurrent Workers needs
  explicit coordination to avoid gap/duplicate `seq` and lost revisions.
- **Live transport colocation.** The DO that owns the state also holds the WebSockets, so
  broadcast is a local fan-out with hibernation (idle rooms free). A D1 design needs a separate
  realtime fabric.
- **Isolation.** DO-per-room contains blast radius — one room cannot corrupt another, and a
  single room is independently resettable.
- Confidence: high. Reversing (moving the event log + Q&A into D1) is a full data migration and
  a realtime-fabric rebuild, so it is recorded here as a deliberate one-way door, not an
  incidental choice.

## Consequences

- The DO is the authority for access decisions; D1 indexes never override it.
- Room recovery is per-room; registry recovery is D1 Time Travel. Two independent recovery
  surfaces, each matched to what it stores.
- Cross-room queries (e.g. "all rooms owned by X") must go through the D1 index, never by
  scanning DOs — the registry carries exactly the indexes needed (`idx_rooms_owner`,
  `idx_slugs_room`).
- Per-room SQLite has a 10 GB ceiling; a single room will never approach it, so no sharding is
  needed.
