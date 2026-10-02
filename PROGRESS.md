# Ask — gorgeous + complete + functional convergence

Mandate: recursively inspect + improve until gorgeous + fully functional; golden-path TDD covering every feature; dogfood the setup prompt in a real agent → ~10 questions on a new repo.

## Improvement inventory (closed / total)

### Visual (gorgeous-by-default)
- [ ] Kumo Empty/cards re-themed dark (no white card on near-black)
- [ ] Headings WCAG AA contrast on dark (≥4.5:1)
- [ ] Brand: #060610 + #00E5FF, Space Grotesk/Sora + JetBrains Mono for ids/slugs
- [ ] Restrained cinematic motion (@starting-style, reduced-motion gated)
- [ ] Mobile one-question focus view + desktop compact list
- [ ] Every state styled: empty, loading, error, connected, answering, disconnected, conflict, private

### Functional (every feature works)
- [ ] All 7 question kinds render + answerable (single/multiple/short/long/number/range/link/image_comparison)
- [ ] 5 explainer lines per card (question/why-now/what-changes/recommendation/continues-without)
- [ ] Skip / Let-the-agent-decide / Explain-more
- [ ] Draft preserved across cards; new question never steals focus/reorders
- [ ] 8 answer-status chips
- [ ] Decisions tab (receipts/decisions) + Activity tab (live event feed)
- [ ] Owner inline slug rename + copy-link toast + overflow
- [ ] Agent check-in state (working/waiting/offline + branch/task)
- [ ] Make-private honest state
- [ ] First-run publishes ~10 high-value questions on a new repo (SKILL.md + helper `ask`)

### Verification
- [ ] Golden-path Playwright suite (every feature) green against prod
- [ ] Vitest DO/worker tests green
- [ ] Dogfood: setup prompt in a fresh agent/repo → ~10 questions appear in app
- [ ] Deployed + prod-smoke green

## Cycle log
- Round 1: built gorgeous dark Kumo UI (root-caused white-card: Kumo needs data-mode="dark") + first-run 10-question briefing. Deployed.
- Visual pass (me): cobalt-ledger 10 cards, 0 white panels, 0 console, axe 0.
- Round 2: progressive-disclosure queue, AA contrast >=6.2:1, accent-ring Now cards, motion. Deployed.
- Dogfood: fresh agent + setup prompt on new repo (widget-shop) -> 10 TAILORED questions in crimson-orchard. PASS.
- Installer fix: helper auto-vendored to .ask/bin/ask.mjs (all hosts).
- Golden-path TDD: 20/20 Vitest + 14/14 Playwright GREEN; caught 2 real bugs (below).

## Known bugs (found by golden-path TDD — fix next session, HARD-STOP at 94% ctx)

1. **Live WS merge broken (P1)** — an already-open browser never merges new Q&A over WebSocket; only reload shows it. Root: Room DO broadcasts id-only event payloads (`apps/ask/worker/room.ts` append/broadcast ~L188,239,264,306) but client `applyEvent` (`apps/ask/src/useRoom.ts:106-148`) expects FULL entities, so nothing merges and `snapshotRequired` stays false. Spec §13 = events carry MINIMAL payload + client reconciles. **Fix (client, src-only, spec-aligned):** in `useRoom.ts`, on ANY `type:'event'` frame, call `getChanges(cursor)` (or re-snapshot) and merge the returned entities — don't require full entities in the frame. Then update `verify-prod.mjs` step 10 to assert the UI state count rises, not just the frame type. NOTE: initial room load (snapshot) works fine — the 10-questions-appear-on-open test PASSES; this bug is only the live-stream-without-reload case.

2. **404 -> 500 (P2)** — answering a nonexistent question returns 500 not 404. Root: `postAnswer` throws `RoomError('question_not_found',404)` INSIDE the DO (`apps/ask/worker/room.ts:202`); crossing JSRPC loses the prototype so `app.onError`'s `e instanceof RoomError` (`apps/ask/worker/index.ts`) is false -> generic 500. **Fix:** have the DO return a typed error result (discriminated union) instead of throwing across RPC, OR map by `e.message`/a serialized `{code,status}` in the worker catch. Apply to all DO methods that throw RoomError across the RPC boundary.
