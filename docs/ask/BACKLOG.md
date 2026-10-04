# Ask — Feature Backlog

Durable arc for the 2026-10-03 feature batch. One coherent slice per fire; re-fire to drain.

## Shipped

- **Apex dashboard** (`/` = your rooms + AI summaries), **per-project `/{owner}/{repo}` URLs**
  (git-repo registry, redirect to slug), **questions grouped by repo**, **two get-started prompts**,
  **hamburger fix**. (commit history — §28-ext.)
- **Real brand logo** (gradient speech-bubble mark + `ask` wordmark) + favicon/PWA icons.

## In progress (this fire)

- **Continual appropriateness check** — the AI enrichment pass now judges each OPEN question's
  `appropriate` (fits the project's inferred stack/domain — e.g. a React question in an Angular
  repo is flagged) + `stale` (overtaken / no longer needs answering), with a one-line `concern`.
  Stored on `QuestionQuality`. ✅ backend.
- **Archive stale/inappropriate questions** — new `archived` question state; the pass AUTO-archives
  open questions it flags (`!appropriate || stale`) with the reason; owner can manually archive/
  restore (`POST /rooms/:id/questions/:qid/archive`). ✅ backend. Frontend: archived disclosure +
  restore + "may not fit" chip (delegated).
- **Cross-repo contamination warning** — banner when a page's questions span ≥2 repos (or mix
  repo'd + un-repo'd — happens when the connected folder is not a git repo). Frontend (delegated).

## Queued

- **GitHub sign-in + auto-detect repo + repo picker + AI repo scan** — 🔑 BLOCKED on a **GitHub
  OAuth app credential** (client id + secret). Plan: OAuth 2.1 (PKCE) flow in the worker → session;
  auto-detect the repo from the connected context, else a live-loading org/repo picker (GitHub API);
  on connect, scan the repo (README + structure via the GitHub API) with Workers AI → seed
  questions. Needs the human to register the OAuth app at https://github.com/settings/developers
  and provide `GITHUB_OAUTH_CLIENT_ID` + `GITHUB_OAUTH_CLIENT_SECRET`.
- **Image / picture questions** — `QuestionKind` already has `image_comparison`; extend so questions
  can carry images (e.g. a "which logo?" question showing candidates, or a design review). Needs
  image sources (the logo generator, once Ideogram/Replicate creds are live — see `logo-generation`).
- **Perfect input type per question** — infra DONE (`QuestionKind`: single/multiple/short_text/
  long_text/number/range/link/image_comparison, each rendered by `QuestionCard`). Remaining: guide
  the publishing AGENT (SKILL.md) to PICK the right `kind` per question instead of defaulting to
  multiple-choice, and add richer kinds (boolean/toggle, date) if demand appears.
