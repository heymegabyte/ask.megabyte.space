# Enrichment (§6)

Server-side AI pass that gives every room a living read of **what the project is
about** and a **quality verdict on each open question** — so the queue stays
useful instead of filling with vague or redundant asks.

## What it does

From ONLY the room's Q&A text (questions + their context/consequence fields +
received answers — never repo files, never secrets), it produces:

1. **Project understanding** — a 2-3 sentence plain-language summary synthesized
   from the Q&A so far.
2. **Question quality** — for each OPEN question: `{ usefulness: 0..1, lame,
improvement }`. `lame` flags vague/redundant/low-value questions; `improvement`
   is one short rewrite suggestion shown only when `lame`.

Both land (optionally) on `RoomSnapshot.understanding` + `.questionQuality` and
broadcast an `enrichment.updated` event so live clients refresh.

## Model

- Primary: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Fallback: `@cf/meta/llama-3.1-8b-instruct`

Called via the Workers AI binding `env.AI.run(...)`. Output is **contract-first**:
every completion is `safeParse`d (`schemas.ts` → `AiEnrichment`), coerced
(usefulness 0..100 → 0..1), verdicts filtered to real open-question ids, and
repaired-or-dropped. `runEnrichment` resolves `null` on any failure and **never
throws** — the core Q&A workflow is wholly unaffected.

## Triggering, throttling, budget (owned by the Room DO)

- Fires on `answer.created` and `question.created`, and on manual
  `POST /api/v1/rooms/:id/enrich`.
- **Throttled** to at most once / 30s per room (a DO alarm coalesces bursts; the
  in-flight pass runs under `ctx.waitUntil`).
- **Budget-capped** at ~50 passes/room. Beyond the cap, or when `env.AI` is
  absent, or when `ENRICHMENT_ENABLED="0"`, it honestly no-ops.

## Flag

Gated by the env var `ENRICHMENT_ENABLED` (default `"1"`; `"0"` = honest-off — no
AI calls, no understanding, no quality, snapshot unchanged).

## Files

- `schemas.ts` — Zod contract for the AI wire shape + the compact input projection.
- `service.ts` — prompt builder, `env.AI.run` call + model fallback, parse/repair,
  mapping to the public `@ask/contracts` shapes.
