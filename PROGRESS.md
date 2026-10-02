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
- (appended per round)
