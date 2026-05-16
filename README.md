# RedLattice

> Native CX analytics for Reddit brand communities. AI-augmented contact-driver tagging, hybrid lexicon + LLM sentiment, verified-agent identity, live pinned dashboard, CSV export for warehouse / Sprinklr-style consumers. Built on Devvit Web.

**Hackathon target:** Best New Mod Tool · Reddit Devvit · May 27, 2026.

---

## What's actually live right now

| | What it does | How a mod sees it |
|---|---|---|
| **Contact-driver tagging** | Lexicon keyword pass on every new post. If confidence < 0.6 or no match, escalates to an LLM (OpenRouter, default `claude-haiku-4.5`) which picks a category from the configured taxonomy and explains why. | Pinned RedLattice dashboard post → Overview tab → recent activity feed shows `driverId` + `· ai` badge + reasoning, OR Drivers tab → click any bar → list of posts tagged that way with deep links back to the actual Reddit post. |
| **Sentiment scoring** | AFINN-165 lexicon on every post + comment. When the lexicon score is in the ambiguous band (`|score| < 0.15`), escalates to an LLM judge. | Dashboard Overview shows daily breakdown; Sentiment tab has a 30-day stacked Area chart. Each entry in the activity feed has a `· positive 0.42` style badge with `· ai` if LLM-judged. |
| **Agent verification** | Mod can mark a comment author as a verified company agent via comment menu; whitelist seeds on install. | Agents tab on the dashboard lists verified users with role + verification date. Comment `…` menu has Mark / Remove verified agent items. |
| **Auto-pinned dashboard** | On `AppInstall` and every `AppUpgrade`, ensures exactly one pinned RedLattice post exists in the subreddit. Idempotent via `rl:pulse:postId`. | Pinned at position 2 in the subreddit feed. The post itself is the React iframe — opens to the full dashboard. |
| **CSV export** | `GET /api/export/posts.csv?limit=N` joins post metadata + driver tags + sentiment in one CSV. | Export tab on the dashboard has one-click download buttons. The endpoint is the integration point for Sprinklr / Khoros / a customer's warehouse. |
| **Cost-capped AI** | Token-based monthly spend tracking with a hard cap per installation (default $5/mo). Above cap → auto-fallback to lexicon. | AI spend card on the Overview tab. Cap is configurable via Devvit global setting `llm-monthly-cost-cap-cents`. |
| **Structured JSON logging** | Every request and module decision emits a single JSON line via `console.*`. Devvit's log stream picks it up. | `npx devvit logs r/<sub>` shows real-time, machine-parseable activity. |
| **Modmail escalation** | When a comment thread accumulates ≥ threshold negative comments within the sample window, a modmail alert fires with a 4h cooldown. | Modmail inbox. Threshold configurable per-subreddit. |

## Start here (newcomer onboarding)

1. **[`docs/00_start_here.md`](docs/00_start_here.md)** — 10-min orientation
2. **[`docs/01_decisions.md`](docs/01_decisions.md)** — every architectural decision and *why* (10 ADRs)
3. **[`docs/02_stack.md`](docs/02_stack.md)** — every dependency, role, version
4. **[`docs/03_devvit_web_primer.md`](docs/03_devvit_web_primer.md)** — Devvit Web concepts
5. **[`docs/04_local_dev.md`](docs/04_local_dev.md)** — running, testing, deploying
6. **[`docs/05_architecture.md`](docs/05_architecture.md)** — module contract, event flow, Redis schema

Reference docs from the original research phase live in [`docs/legacy/`](docs/legacy/). They use the old project name "BrandPulse" — same project, renamed before any code was written.

## Quick commands

```bash
npm install         # install deps
npm run type-check  # tsc strict, server + client
npm run lint        # Biome
npm run test        # Vitest — currently 37 passing across 5 files
npm run dev         # devvit playtest — live-reload on the configured test subreddit
npm run build       # production bundle to dist/
npm run deploy      # devvit upload (private app directory)
npm run launch      # devvit publish (post-hackathon)
```

## Project layout

```
redlattice/
├── devvit.json                       # Devvit Web manifest (v1) — triggers, menu, scheduler, settings
├── package.json
├── tsconfig.{base,server,client}.json
├── vite.config.ts                    # @devvit/start plugin orchestrates client + server builds
├── biome.json                        # lint + format
├── src/
│   ├── server/index.ts               # Hono server, /internal/* + /api/* routes
│   ├── client/                       # React 19 SPA — Daily Pulse + Dashboard
│   │   ├── App.tsx, main.tsx, index.html, styles.css
│   │   ├── lib/api.ts                # typed fetch helpers
│   │   └── views/{Pulse,Dashboard}.tsx
│   ├── modules/
│   │   ├── agent-verification/       # whitelist, mark/unmark, API routes
│   │   ├── contact-drivers/          # keyword + LLM hybrid tagging
│   │   ├── sentiment/                # AFINN + LLM hybrid scoring + modmail escalation
│   │   └── dashboard-orchestrator/   # auto-pin Daily Pulse on install/upgrade
│   └── shared/
│       ├── types.ts                  # module contract + domain models
│       ├── keys.ts                   # Redis key namespace under rl:
│       ├── log.ts                    # JSON console logger with redaction
│       ├── validation.ts             # Zod schemas at every boundary
│       ├── permissions.ts            # requireMod() with 5-min cache, fail-closed
│       ├── ratelimit.ts              # Redis token bucket
│       ├── idempotency.ts            # hSetNX + TTL claim-once
│       ├── storage.ts                # typed Redis accessors; HASH-based atomic rollups
│       ├── llm.ts                    # OpenRouter + Vercel AI SDK, cost-capped + cached + retried
│       └── dispatcher.ts             # module event fan-out with failure isolation
├── tests/                            # Vitest pure-logic tests
└── docs/                             # ADRs, primers, architecture
```

## REST endpoints (mod-only)

```
GET  /api/health
GET  /api/admin/debug                          state inspection
GET  /api/dashboard/summary                    counters + AI spend
GET  /api/dashboard/recent-posts?limit=N
GET  /api/drivers/taxonomy
GET  /api/drivers/volume?from=&to=
GET  /api/drivers/:driverId/posts?limit=N
POST /api/drivers/tag                          { postId, driverId }
GET  /api/sentiment/rollup?from=&to=
GET  /api/sentiment/:contentId
GET  /api/agents
GET  /api/agents/:username
POST /api/agents                               { usernames: [...] }
GET  /api/export/posts.csv?limit=N
```

## Devvit settings

**Global (developer-set, encrypted):**
- `openrouter-api-key` — OpenRouter API key (already set)
- `llm-model` — model slug (default `anthropic/claude-haiku-4.5`)
- `llm-monthly-cost-cap-cents` — hard cap, default 500 = $5

**Subreddit (mod-configurable per install):**
- `agent-whitelist` — newline-separated usernames pre-seeded on install
- `taxonomy-json` — optional custom taxonomy
- `sentiment-threshold` — negative-comment count before escalation (default 5)
- `sla-minutes` — first-response SLA, Phase 2 wiring (default 120)

---

License: BSD-3-Clause.
