# Ask

**Answer the questions your coding agents should have been asking all along.**

Ask is a free, open-source Cloudflare service where developers answer the decision questions
their coding agents publish. An agent posts a batch of questions to a room; you open the room's
URL and answer; the agent reads your answers and records what it applied. No account needed to
answer a public room.

- Live: <https://fuegol.ink>
- MIT licensed · Cloudflare-native · self-hostable

## How it works

1. Your coding agent **enrolls** in a room (a memorable URL like `fuegol.ink/amber-harbor`).
2. It **publishes questions** — choices, text, numbers, links, image comparisons — each with
   context, the consequence of each answer, and an optional recommendation.
3. You **open the room and answer**. Updates are live; no sign-in for a public room.
4. The agent **reads your answers** and posts **receipts** (downloaded → applied → verified) with
   the relative paths it changed.

## Free vs private ($10/month)

- **Public rooms are free, forever.** Public means unlisted-and-shareable — anyone with the link
  can view and answer, but nothing is ever indexed by search engines.
- **Private rooms are USD $10/month per page** on the hosted service — only you can read them.
  This is a billing policy of fuegol.ink, not a code paywall. A lapse never makes a
  private room public (7-day grace, then private read-only). _(Private rooms + billing are
  Increment 3 — see the roadmap.)_

## Self-hosting

Run Ask on your own Cloudflare account and **private rooms are included free** — privacy is a
capability of the software, not a hosted paywall. The hosted $10/month buys convenience, not a
feature you can't get otherwise.

```sh
git clone https://github.com/heymegabyte/fuegol.ink.git
cd fuegol.ink && pnpm install
# set your D1 id + SERVICE_ORIGIN in apps/ask/wrangler.jsonc, then:
pnpm build && pnpm --filter @ask/app deploy
```

Full guide: [`docs/self-hosting.md`](docs/self-hosting.md).

## Architecture (short)

One deployable Cloudflare app: a React SPA and a Hono Worker on one origin (unified by the CF
Vite plugin). Each room is one SQLite-backed Durable Object — authoritative for its Q&A,
answer-revision chain, receipts, event log, and live WebSockets. D1 is a thin registry (unique
slugs + immutable room id + billing inbox); it never duplicates Q&A. Zod in `packages/contracts`
is the single source of truth for every boundary.

Details: [`docs/architecture.md`](docs/architecture.md) · protocol:
[`docs/protocol.md`](docs/protocol.md).

## Status

The free **ask → answer → apply** loop is live. Private rooms, shared login, Stripe billing,
native MCP, and R2/Queues/Workflows/Workers-AI enrichment are later increments — honestly tracked
in [`docs/capability-matrix.md`](docs/capability-matrix.md) and [`TODO.md`](TODO.md). Endpoints
for unbuilt features return an honest `501`, never a fake success.

## Repo layout

- `apps/ask/` — the deployable app (React `src/` + Worker `worker/`).
- `packages/contracts/` — Zod schemas, routes, events, limits (SSOT).
- `packages/agent-integration/` — agent HTTP helper + host adapters (scaffold; Increment 2).
- `docs/` — plan, capability matrix, protocol, architecture, decisions, auth, self-hosting,
  deployment, privacy, verification.

## Docs

| Doc                                                                     | What                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| [plan](docs/plan.md)                                                    | Implementation plan + 5-increment build order     |
| [capability-matrix](docs/capability-matrix.md)                          | Every capability × LIVE / adapter-only / planned  |
| [protocol](docs/protocol.md)                                            | Entities, routes, events, reconnect semantics     |
| [architecture](docs/architecture.md)                                    | Components, data flow, DO-per-room, assets gotcha |
| [decisions/](docs/decisions/)                                           | ADRs 0001–0005                                    |
| [auth-integration](docs/auth-integration.md)                            | Anonymous owner, agent token, shared OAuth        |
| [self-hosting](docs/self-hosting.md) · [deployment](docs/deployment.md) | Run your own / ship it                            |
| [privacy](docs/privacy.md) · [verification](docs/verification.md)       | Discovery-off model / acceptance gate             |

## License

MIT © 2026 Brian Zalewski / Megabyte Labs. See [`LICENSE`](LICENSE).
