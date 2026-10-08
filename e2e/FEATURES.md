# Ask — E2E / Feature Coverage

Golden-path coverage for **fuegol.ink**. Two layers:

- **Worker + Room DO** (`apps/ask/test/*.spec.ts`) — `@cloudflare/vitest-pool-workers`, `SELF` from `cloudflare:test`, real Miniflare D1 + Durable Object. Hermetic (fresh room per test).
- **Browser E2E** (`e2e/golden/*.spec.ts`) — real Chromium via Playwright against the live PROD deploy, homepage-start, navigate via clicks, questions seeded through the real API. 6 viewports (375/390/768/1024/1280/1920). Screenshots → `e2e/screenshots/<test>/<step>.png`.

Run:

```bash
pnpm --filter @ask/app exec vitest run
pnpm --filter @ask/app exec playwright install chromium
PROD_URL=https://ask-megabyte-space.manhattan.workers.dev pnpm --filter @ask/app exec playwright test e2e/golden --project=chromium-1280
```

## Worker + Room DO (vitest) — 20 tests

| #   | Feature                     | Spec                                 | Assertion                                                                                         |
| --- | --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 1   | Health                      | `room-lifecycle.spec.ts`             | `GET /api/health` → 200 `{status:ok, api:v1, version}`                                            |
| 2   | Create room                 | `room-lifecycle.spec.ts`             | owned room, `rm_` id, word-based slug, `ask_sid` Set-Cookie                                       |
| 3   | Create w/ chosen slug       | `room-lifecycle.spec.ts`             | requested valid slug honored, owned=true                                                          |
| 4   | Reserved slug rejected      | `room-lifecycle.spec.ts`             | `slug:'admin'` → 400                                                                              |
| 5   | Resolve by slug → guest     | `room-lifecycle.spec.ts`             | 2nd principal resolves slug → same room, `viewerRole:guest`, fresh cookie                         |
| 6   | Owner role + immutable id   | `room-lifecycle.spec.ts`             | owner cookie → `viewerRole:owner`; id identical by slug + by id                                   |
| 7   | noindex + no-store headers  | `room-lifecycle.spec.ts`             | `X-Robots-Tag: noindex`, `Cache-Control: no-store`                                                |
| 8   | Unknown id / route → 404    | `room-lifecycle.spec.ts`             | missing room id → 404; `/api/v1/nope` → 404                                                       |
| 9   | Agent enrollment            | `questions-answers-receipts.spec.ts` | `ai_` install id + scoped `Bearer id.token`                                                       |
| 10  | Question dedupKey upsert    | `questions-answers-receipts.spec.ts` | 1st created=1/deduped=0; 2nd created=0/deduped=1, same `q_` id                                    |
| 11  | Public answer append        | `questions-answers-receipts.spec.ts` | no login → `a_` id, status `answer_saved`                                                         |
| 12  | Answer missing question     | `questions-answers-receipts.spec.ts` | answering unknown `q_` → 404                                                                      |
| 13  | Receipt requires Bearer     | `questions-answers-receipts.spec.ts` | no bearer → **401** (no forged receipts)                                                          |
| 14  | Receipt w/ Bearer → applied | `questions-answers-receipts.spec.ts` | 201 `rcpt_`; snapshot answer status → `applied_to_project`; receipt present                       |
| 15  | Rename — guest blocked      | `rename-and-changes.spec.ts`         | non-owner PATCH settings → 403                                                                    |
| 16  | Rename — owner + alias      | `rename-and-changes.spec.ts`         | 200, immutable id, new slug resolves, **old slug aliases** to same room                           |
| 17  | Rename — taken slug         | `rename-and-changes.spec.ts`         | rename to existing slug → 409                                                                     |
| 18  | Changes event chain         | `rename-and-changes.spec.ts`         | `cursor=0` → `room.created`+`question.created`+`answer.created`+`receipt.recorded`, monotonic seq |
| 19  | Changes cursor exhausted    | `rename-and-changes.spec.ts`         | cursor past head → 0 new events                                                                   |
| 20  | Billing honesty             | `rename-and-changes.spec.ts`         | checkout → **501** (never fake success)                                                           |
| —   | **BUG tripwire**            | `questions-answers-receipts.spec.ts` | `it.fails`: answering unknown question SHOULD be 404 (currently 500 — see §Known bugs)            |

## Browser E2E (Playwright) — golden path

| #   | Feature                      | Spec                       | Flow / assertion                                                                                              |
| --- | ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| E1  | Entry auto-creates room      | `golden-path.spec.ts`      | `/` → URL adopts `/<slug>`, `copy-setup-prompt` visible+clickable, prompt `<pre>` shows, **0 console errors** |
| E2  | Single-choice answer → Saved | `golden-path.spec.ts`      | seeded question-card → pick `Cloudflare D1` → `answer-submit` → `status-chip` = Saved                         |
| E3  | Skip                         | `golden-path.spec.ts`      | `answer-skip` → saved chip                                                                                    |
| E4  | Delegate                     | `golden-path.spec.ts`      | `answer-delegate` ("Let the agent decide") → saved chip                                                       |
| E5  | Explain more                 | `golden-path.spec.ts`      | `answer-explain` → "Requested" (honest 501 state)                                                             |
| E6  | Tab switches                 | `golden-path.spec.ts`      | Questions → Decisions → Activity → back, each renders content                                                 |
| E7  | Owner rename                 | `golden-path.spec.ts`      | slug wordmark → `slug-input` → Enter → URL + header adopt new slug                                            |
| E8  | Copy link                    | `golden-path.spec.ts`      | `copy-link` visible + clickable                                                                               |
| E9  | TWO-context live (WS)        | `live-and-privacy.spec.ts` | **`test.fail()` tripwire** — both open browsers should see a new question with NO reload (see §Known bugs)    |
| E10 | Write + snapshot path        | `live-and-privacy.spec.ts` | the same new question IS visible after a reload (proves write path healthy)                                   |
| E11 | Make-private honesty         | `live-and-privacy.spec.ts` | `make-private` → "coming soon" banner, page stays **Public**, nothing charged                                 |
| E12 | Mobile 375 focus view        | `live-and-privacy.spec.ts` | @375 `focus-toggle` → one-question view, "Question N of M", **0 horizontal overflow**                         |
| E13 | axe @ 375                    | `accessibility.spec.ts`    | 0 serious/critical across Questions · Decisions · Activity                                                    |
| E14 | axe @ 1280                   | `accessibility.spec.ts`    | 0 serious/critical across Questions · Decisions · Activity                                                    |

## data-testid selectors exercised

`copy-setup-prompt` · `free-button`† · `claim-button`† · `question-card` · `answer-submit` · `answer-skip` · `answer-delegate` · `answer-explain` · `status-chip` · `slug-input` · `copy-link` · `make-private` · `focus-toggle` · `tab-questions`/`tab-decisions`/`tab-activity` (via Kumo `role=tab`) · `connection-state`.

† `free-button` (root create-flow retry) and `claim-button` (404-slug claim) are off the golden path (they appear only on create-failure / unclaimed-slug) — the homepage auto-creates on first load, so the golden path exercises the success path. They are available for negative-path specs.

## Known product bugs (documented by tripwire tests, NOT patched — product code out of scope)

1. **Live propagation broken (no-reload merge).** An already-open browser does NOT receive new questions/answers/receipts over the live WebSocket — only a manual reload shows them. Root cause: the Room DO emits id-only event payloads (`{questionId,title}`, `{questionId,answerId}`, …) but the client's `applyEvent` (`src/useRoom.ts:106-148`) requires the full entity (`p.question`/`p.answer`/`p.receipt`), so every event fails to merge and nothing refetches (`snapshotRequired` is false). Fix: include the full entity in each `append(...)` payload in `worker/room.ts`, OR refetch the snapshot when `applyEvent` returns null. Tracked by `live-and-privacy.spec.ts` E9 (`test.fail()`).
2. **404→500 on answering a missing question.** `postAnswer` throws `RoomError('question_not_found', 404)` INSIDE the Room DO; crossing the JSRPC boundary loses the prototype, so `app.onError`'s `e instanceof RoomError` check (`worker/index.ts:44`) is false → generic `internal_error` 500. Fix: carry the error code/status across the DO boundary (return a typed result, or re-tag in the handler). Tracked by `questions-answers-receipts.spec.ts` (`it.fails`).

Both tripwires PASS while the bug exists and FLIP (fail / unexpected-pass) the moment the product is fixed.
